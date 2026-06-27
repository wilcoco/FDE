import { prisma } from "./db";
import type {
  NodeType,
  ProcessEdge,
  ProcessNode,
  Prisma,
} from "@prisma/client";

/**
 * Process engine
 * ----------------------------------------------------------------------------
 * Drives a ProcessInstance through its definition graph. Unlike a linear
 * approval chain, work flows node-to-node along directed edges; APPROVAL is
 * just one node type the flow can pause on. The engine:
 *   - auto-runs START / AUTOMATION / CONDITION / END nodes,
 *   - pauses on TASK / APPROVAL nodes (waiting for a human),
 *   - resumes when a human completes a task or decides an approval.
 *
 * MVP scope: acyclic graphs, each node activated at most once per instance.
 */

type Tx = Prisma.TransactionClient;

interface Condition {
  field?: string;
  op?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  value?: unknown;
}

function evalCondition(cond: Condition, data: Record<string, unknown>): boolean {
  // Empty condition = default / always-true edge (used as the "else" branch).
  if (!cond || !cond.field || !cond.op) return true;
  const left = data[cond.field];
  const right = cond.value;
  switch (cond.op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

interface Graph {
  nodes: Map<string, ProcessNode>;
  outgoing: Map<string, ProcessEdge[]>; // fromNodeId -> edges (ordered)
}

async function loadGraph(tx: Tx, definitionId: string): Promise<Graph> {
  const [nodes, edges] = await Promise.all([
    tx.processNode.findMany({ where: { definitionId } }),
    tx.processEdge.findMany({
      where: { definitionId },
      orderBy: { order: "asc" },
    }),
  ]);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, ProcessEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.fromNodeId) ?? [];
    list.push(e);
    outgoing.set(e.fromNodeId, list);
  }
  return { nodes: nodeMap, outgoing };
}

/**
 * Activate `node` for the instance and continue the flow as far as it can go
 * without human input. Returns when every reachable path is either finished or
 * blocked on a TASK/APPROVAL.
 */
async function activate(
  tx: Tx,
  tenantId: string,
  instanceId: string,
  node: ProcessNode,
  graph: Graph,
  data: Record<string, unknown>,
): Promise<void> {
  const run = await tx.nodeInstance.findFirst({
    where: { instanceId, nodeId: node.id },
  });
  // Guard against re-activation (joins / already-processed nodes).
  if (!run || run.status !== "WAITING") return;

  const followOutgoing = async (chosen?: ProcessEdge[]) => {
    const edges = chosen ?? graph.outgoing.get(node.id) ?? [];
    for (const edge of edges) {
      const next = graph.nodes.get(edge.toNodeId);
      if (next) await activate(tx, tenantId, instanceId, next, graph, data);
    }
  };

  switch (node.type as NodeType) {
    case "START": {
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() },
      });
      await followOutgoing();
      return;
    }

    case "AUTOMATION": {
      const config = (node.config as Record<string, unknown>) ?? {};
      const output = runAutomation(config, data);
      // automation may write back into the shared instance data bag
      Object.assign(data, output.dataPatch ?? {});
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          activatedAt: new Date(),
          decidedAt: new Date(),
          output: output.output as Prisma.InputJsonValue,
        },
      });
      await followOutgoing();
      return;
    }

    case "CONDITION": {
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() },
      });
      const edges = graph.outgoing.get(node.id) ?? [];
      // first edge whose condition matches; empty-condition edge acts as else
      const taken = edges.find((e) =>
        evalCondition(e.condition as Condition, data),
      );
      await followOutgoing(taken ? [taken] : []);
      return;
    }

    case "TASK":
    case "APPROVAL": {
      // Pause here — assignee comes from node config.
      const config = (node.config as Record<string, unknown>) ?? {};
      const assigneeId =
        typeof config.assigneeId === "string" ? config.assigneeId : null;
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: { status: "ACTIVE", activatedAt: new Date(), assigneeId },
      });
      return; // wait for human
    }

    case "END": {
      await tx.nodeInstance.update({
        where: { id: run.id },
        data: { status: "DONE", activatedAt: new Date(), decidedAt: new Date() },
      });
      await tx.processInstance.update({
        where: { id: instanceId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return;
    }
  }
}

function runAutomation(
  config: Record<string, unknown>,
  data: Record<string, unknown>,
): { output: Record<string, unknown>; dataPatch?: Record<string, unknown> } {
  const action = String(config.action ?? "noop");
  const params = (config.params as Record<string, unknown>) ?? {};
  switch (action) {
    case "setField":
      return {
        output: { action, field: params.field, value: params.value },
        dataPatch: { [String(params.field)]: params.value },
      };
    case "notify":
      // In a real deployment this would enqueue email/Slack/etc.
      return { output: { action, message: params.message ?? "" } };
    default:
      return { output: { action } };
  }
}

/** Create and kick off a new instance of a definition. */
export async function startInstance(args: {
  tenantId: string;
  definitionId: string;
  title: string;
  data: Record<string, unknown>;
  initiatorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const graph = await loadGraph(tx, args.definitionId);
    const allNodes = [...graph.nodes.values()];
    const start = allNodes.find((n) => n.type === "START");
    if (!start) throw new Error("Process has no START node");

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

    // Pre-create a NodeInstance (WAITING) per node — the live progress board.
    await tx.nodeInstance.createMany({
      data: allNodes.map((n) => ({
        tenantId: args.tenantId,
        instanceId: instance.id,
        nodeId: n.id,
        nodeKey: n.key,
        type: n.type,
        name: n.name,
        status: "WAITING" as const,
      })),
    });

    const data = { ...args.data };
    await activate(tx, args.tenantId, instance.id, start, graph, data);
    // persist any automation-driven data changes
    await tx.processInstance.update({
      where: { id: instance.id },
      data: { data: data as Prisma.InputJsonValue },
    });

    return instance;
  });
}

/** Resume the flow after a node run reaches a terminal state. */
async function resumeFrom(
  tx: Tx,
  tenantId: string,
  instanceId: string,
  fromNodeId: string,
) {
  const instance = await tx.processInstance.findFirst({
    where: { id: instanceId, tenantId },
  });
  if (!instance) return;
  const graph = await loadGraph(tx, instance.definitionId);
  const data = { ...(instance.data as Record<string, unknown>) };
  const edges = graph.outgoing.get(fromNodeId) ?? [];
  for (const edge of edges) {
    const next = graph.nodes.get(edge.toNodeId);
    if (next) await activate(tx, tenantId, instanceId, next, graph, data);
  }
  await tx.processInstance.update({
    where: { id: instanceId },
    data: { data: data as Prisma.InputJsonValue },
  });
}

/** Mark a TASK node done and advance. */
export async function completeTask(args: {
  tenantId: string;
  nodeRunId: string;
  userId: string;
  output?: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.nodeInstance.findFirst({
      where: { id: args.nodeRunId, tenantId: args.tenantId },
    });
    if (!run || run.status !== "ACTIVE" || run.type !== "TASK") {
      throw new Error("Task is not actionable");
    }
    await tx.nodeInstance.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        decidedAt: new Date(),
        output: (args.output ?? {}) as Prisma.InputJsonValue,
      },
    });
    await resumeFrom(tx, args.tenantId, run.instanceId, run.nodeId);
  });
}

/** Approve or reject an APPROVAL node and advance (or terminate on reject). */
export async function decideApproval(args: {
  tenantId: string;
  nodeRunId: string;
  userId: string;
  approve: boolean;
  comment?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.nodeInstance.findFirst({
      where: { id: args.nodeRunId, tenantId: args.tenantId },
    });
    if (!run || run.status !== "ACTIVE" || run.type !== "APPROVAL") {
      throw new Error("Approval is not actionable");
    }
    await tx.nodeInstance.update({
      where: { id: run.id },
      data: {
        status: args.approve ? "APPROVED" : "REJECTED",
        decidedAt: new Date(),
        comment: args.comment,
      },
    });

    if (!args.approve) {
      // a rejection terminates the whole instance
      await tx.processInstance.update({
        where: { id: run.instanceId },
        data: { status: "REJECTED", completedAt: new Date() },
      });
      return;
    }
    await resumeFrom(tx, args.tenantId, run.instanceId, run.nodeId);
  });
}
