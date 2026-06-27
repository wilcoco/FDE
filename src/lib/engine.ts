import { prisma } from "./db";
import { notify } from "./notify";
import { createApprovalRequest } from "./approval";
import { resolveOrgChain, resolveAmountTier } from "./orgchart";
import type { NodeInstance, Prisma } from "@prisma/client";

/**
 * Process engine — drives a ProcessInstance through its OWN graph
 * (NodeInstance + InstanceEdge, copied from the template at launch so it can be
 * modified at runtime). Auto-runs START/AUTOMATION/CONDITION/END; pauses on
 * TASK (assignee acts) and APPROVAL (delegates to the common approval module).
 * Supports rework cycles (directives) and ad-hoc node insertion (협조업무).
 */

type Tx = Prisma.TransactionClient;

interface Condition {
  field?: string;
  op?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  value?: unknown;
}

function evalCondition(c: Condition, data: Record<string, unknown>): boolean {
  if (!c || !c.field || !c.op) return true; // empty = default/else edge
  const l = data[c.field];
  const r = c.value;
  switch (c.op) {
    case "eq": return l === r;
    case "ne": return l !== r;
    case "gt": return Number(l) > Number(r);
    case "gte": return Number(l) >= Number(r);
    case "lt": return Number(l) < Number(r);
    case "lte": return Number(l) <= Number(r);
    default: return false;
  }
}

interface Graph {
  outgoing: Map<string, { toKey: string; condition: Condition; order: number }[]>;
}

async function loadGraph(tx: Tx, instanceId: string): Promise<Graph> {
  const edges = await tx.instanceEdge.findMany({
    where: { instanceId },
    orderBy: { order: "asc" },
  });
  const outgoing = new Map<string, { toKey: string; condition: Condition; order: number }[]>();
  for (const e of edges) {
    const list = outgoing.get(e.fromKey) ?? [];
    list.push({ toKey: e.toKey, condition: (e.condition as Condition) ?? {}, order: e.order });
    outgoing.set(e.fromKey, list);
  }
  return { outgoing };
}

function runAutomation(config: Record<string, unknown>, data: Record<string, unknown>) {
  const action = String(config.action ?? "noop");
  const params = (config.params as Record<string, unknown>) ?? {};
  switch (action) {
    case "setField":
      return { output: { action, field: params.field }, patch: { [String(params.field)]: params.value } };
    case "notify":
      return { output: { action, message: params.message ?? "" }, patch: {} };
    default:
      return { output: { action }, patch: {} };
  }
}

/** Resolve approvers for an APPROVAL node from its config + the initiator. */
async function resolveApprovers(
  tx: Tx,
  tenantId: string,
  initiatorId: string,
  run: NodeInstance,
  data: Record<string, unknown>,
): Promise<{ approverIds: string[]; routingType: "ORG_CHAIN" | "AMOUNT_TIER" | "FIXED"; amount?: number }> {
  const cfg = (run.config as Record<string, unknown>) ?? {};
  const assignee = (cfg.assignee as Record<string, unknown>) ?? {};
  if (run.approvalKind === "COST") {
    const amountField = String(assignee.amountField ?? "amount");
    const amount = Number(data[amountField] ?? 0);
    const ids = await resolveAmountTier(tx, tenantId, initiatorId, amount);
    return { approverIds: ids, routingType: "AMOUNT_TIER", amount };
  }
  if (assignee.kind === "FIXED" && typeof assignee.userId === "string") {
    return { approverIds: [assignee.userId], routingType: "FIXED" };
  }
  // default GENERAL: org-relative up the reporting line
  const levels = typeof assignee.levels === "number" ? assignee.levels : 1;
  const ids = await resolveOrgChain(tx, initiatorId, { levels });
  return { approverIds: ids, routingType: "ORG_CHAIN" };
}

/** Activate a WAITING node and continue the flow as far as it can without humans. */
async function activate(
  tx: Tx,
  ctx: { tenantId: string; instanceId: string; initiatorId: string },
  nodeKey: string,
  graph: Graph,
  data: Record<string, unknown>,
): Promise<void> {
  const run = await tx.nodeInstance.findFirst({
    where: { instanceId: ctx.instanceId, nodeKey },
  });
  if (!run || run.status !== "WAITING") return;

  const follow = async (chosen?: { toKey: string }[]) => {
    const edges = chosen ?? graph.outgoing.get(nodeKey) ?? [];
    for (const e of edges) await activate(tx, ctx, e.toKey, graph, data);
  };

  switch (run.type) {
    case "START": {
      await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() } });
      await follow();
      return;
    }
    case "AUTOMATION": {
      const { output, patch } = runAutomation((run.config as Record<string, unknown>) ?? {}, data);
      Object.assign(data, patch);
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date(), config: { ...(run.config as object), lastOutput: output } as Prisma.InputJsonValue },
      });
      await follow();
      return;
    }
    case "CONDITION": {
      await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() } });
      const edges = graph.outgoing.get(nodeKey) ?? [];
      const taken = edges.find((e) => evalCondition(e.condition, data));
      await follow(taken ? [taken] : []);
      return;
    }
    case "TASK": {
      await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
      if (run.assigneeId) {
        await notify(tx, { tenantId: ctx.tenantId, userId: run.assigneeId, type: "TASK_ASSIGNED", title: `작업이 배정되었습니다: ${run.name}`, link: `/instances/${ctx.instanceId}` });
      }
      return;
    }
    case "APPROVAL": {
      const { approverIds, routingType, amount } = await resolveApprovers(tx, ctx.tenantId, ctx.initiatorId, run, data);
      await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
      const req = await createApprovalRequest(tx, {
        tenantId: ctx.tenantId,
        subjectType: "NODE_APPROVAL",
        subjectId: run.id,
        routingType,
        amount,
        requesterId: ctx.initiatorId,
        approverIds,
        nodeInstanceId: run.id,
        note: `[프로세스 결재] ${run.name}`,
      });
      // empty chain → auto-approved by the module; resolve immediately
      if (req.status === "APPROVED") {
        await onNodeApprovalResolved(tx, ctx.tenantId, run.id, true);
      }
      return;
    }
    case "END": {
      await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() } });
      await tx.processInstance.update({ where: { id: ctx.instanceId }, data: { status: "COMPLETED", completedAt: new Date() } });
      return;
    }
  }
}

async function resumeFrom(tx: Tx, tenantId: string, instanceId: string, fromKey: string) {
  const instance = await tx.processInstance.findFirst({ where: { id: instanceId, tenantId } });
  if (!instance || instance.status !== "RUNNING") return;
  const graph = await loadGraph(tx, instanceId);
  const data = { ...(instance.data as Record<string, unknown>) };
  const ctx = { tenantId, instanceId, initiatorId: instance.initiatorId };
  for (const e of graph.outgoing.get(fromKey) ?? []) {
    await activate(tx, ctx, e.toKey, graph, data);
  }
  await tx.processInstance.update({ where: { id: instanceId }, data: { data: data as Prisma.InputJsonValue } });
}

// ── public API ──────────────────────────────────────────────────────────────

/** Launch an instance from a definition. `assignments` maps nodeKey → userId. */
export async function startInstance(args: {
  tenantId: string;
  definitionId: string;
  title: string;
  data: Record<string, unknown>;
  initiatorId: string;
  assignments: Record<string, string>;
}) {
  return prisma.$transaction(async (tx) => {
    const [nodes, edges] = await Promise.all([
      tx.processNode.findMany({ where: { definitionId: args.definitionId } }),
      tx.processEdge.findMany({ where: { definitionId: args.definitionId } }),
    ]);
    const start = nodes.find((n) => n.type === "START");
    if (!start) throw new Error("프로세스에 START 노드가 없습니다");
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const instance = await tx.processInstance.create({
      data: {
        tenantId: args.tenantId,
        definitionId: args.definitionId,
        title: args.title,
        data: args.data as Prisma.InputJsonValue,
        initiatorId: args.initiatorId,
        status: "RUNNING",
      },
    });

    // copy nodes → NodeInstance (TASK assignee from launch-time assignments or fixed config)
    for (const n of nodes) {
      const cfg = (n.config as Record<string, unknown>) ?? {};
      const assigneeSpec = (cfg.assignee as Record<string, unknown>) ?? {};
      let assigneeId: string | null = null;
      if (n.type === "TASK") {
        if (args.assignments[n.key]) assigneeId = args.assignments[n.key];
        else if (assigneeSpec.kind === "FIXED" && typeof assigneeSpec.userId === "string") assigneeId = assigneeSpec.userId;
      }
      await tx.nodeInstance.create({
        data: {
          tenantId: args.tenantId,
          instanceId: instance.id,
          nodeKey: n.key,
          type: n.type,
          name: n.name,
          approvalKind: n.approvalKind,
          status: "WAITING",
          assigneeId,
          config: n.config as Prisma.InputJsonValue,
        },
      });
    }
    // copy edges → InstanceEdge (keyed by nodeKey)
    for (const e of edges) {
      const from = nodeById.get(e.fromNodeId);
      const to = nodeById.get(e.toNodeId);
      if (!from || !to) continue;
      await tx.instanceEdge.create({
        data: {
          tenantId: args.tenantId,
          instanceId: instance.id,
          fromKey: from.key,
          toKey: to.key,
          label: e.label,
          condition: e.condition as Prisma.InputJsonValue,
          order: e.order,
        },
      });
    }

    const graph = await loadGraph(tx, instance.id);
    const data = { ...args.data };
    await activate(tx, { tenantId: args.tenantId, instanceId: instance.id, initiatorId: args.initiatorId }, start.key, graph, data);
    await tx.processInstance.update({ where: { id: instance.id }, data: { data: data as Prisma.InputJsonValue } });
    return instance;
  });
}

/** Mark a TASK done and advance the flow. */
export async function completeTask(args: { tenantId: string; nodeRunId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.nodeInstance.findFirst({ where: { id: args.nodeRunId, tenantId: args.tenantId } });
    if (!run || run.status !== "ACTIVE" || run.type !== "TASK") throw new Error("완료할 수 있는 작업이 아닙니다");
    await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "DONE", decidedAt: new Date() } });
    await resumeFrom(tx, args.tenantId, run.instanceId, run.nodeKey);
  });
}

/** Apply an approval decision to an APPROVAL node (called after the module resolves). */
export async function onNodeApprovalResolved(tx: Tx, tenantId: string, nodeInstanceId: string, approved: boolean) {
  const run = await tx.nodeInstance.findFirst({ where: { id: nodeInstanceId, tenantId } });
  if (!run) return;
  if (approved) {
    await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await resumeFrom(tx, tenantId, run.instanceId, run.nodeKey);
  } else {
    await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "REJECTED", decidedAt: new Date() } });
    await tx.processInstance.update({ where: { id: run.instanceId }, data: { status: "REJECTED", completedAt: new Date() } });
  }
}

/** Issue a work directive — reopens the task for rework. */
export async function issueDirective(args: { tenantId: string; nodeInstanceId: string; issuerId: string; body: string }) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.nodeInstance.findFirst({ where: { id: args.nodeInstanceId, tenantId: args.tenantId } });
    if (!run || run.type !== "TASK") throw new Error("업무 지시를 내릴 수 있는 작업이 아닙니다");
    await tx.directive.create({ data: { tenantId: args.tenantId, nodeInstanceId: run.id, issuerId: args.issuerId, body: args.body, status: "OPEN" } });
    await tx.nodeInstance.update({ where: { id: run.id }, data: { status: "ACTIVE", reworkCount: { increment: 1 }, decidedAt: null } });
    if (run.assigneeId) {
      await notify(tx, { tenantId: args.tenantId, userId: run.assigneeId, type: "DIRECTIVE", title: `업무 지시(재작업): ${run.name}`, body: args.body, link: `/instances/${run.instanceId}` });
    }
  });
}

/** Apply an approved ad-hoc change: insert a collaboration task into the instance. */
export async function applyInstanceChange(tx: Tx, tenantId: string, changeId: string) {
  const change = await tx.instanceChange.findFirst({ where: { id: changeId, tenantId } });
  if (!change || change.status !== "APPROVED") return;
  const newKey = `adhoc-${change.id.slice(-6)}`;

  await tx.nodeInstance.create({
    data: {
      tenantId,
      instanceId: change.instanceId,
      nodeKey: newKey,
      type: "TASK",
      name: change.newTaskName,
      status: "ACTIVE",
      assigneeId: change.newTaskAssigneeId,
      isAdHoc: true,
      activatedAt: new Date(),
      config: { description: change.description ?? "" } as Prisma.InputJsonValue,
    },
  });

  if (change.mode === "INLINE" && change.afterNodeKey) {
    // re-route: afterNode → newKey → (afterNode's original successors)
    await tx.instanceEdge.updateMany({
      where: { instanceId: change.instanceId, fromKey: change.afterNodeKey },
      data: { fromKey: newKey },
    });
    await tx.instanceEdge.create({
      data: { tenantId, instanceId: change.instanceId, fromKey: change.afterNodeKey, toKey: newKey, order: 0 },
    });
  } else if (change.afterNodeKey) {
    // parallel side-branch (informational edge; does not gate the main flow)
    await tx.instanceEdge.create({
      data: { tenantId, instanceId: change.instanceId, fromKey: change.afterNodeKey, toKey: newKey, order: 99 },
    });
  }

  await tx.instanceChange.update({ where: { id: change.id }, data: { status: "APPLIED", appliedAt: new Date() } });
  if (change.newTaskAssigneeId) {
    await notify(tx, { tenantId, userId: change.newTaskAssigneeId, type: "TASK_ASSIGNED", title: `협조 업무가 배정되었습니다: ${change.newTaskName}`, link: `/instances/${change.instanceId}` });
  }
}
