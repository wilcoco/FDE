"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext, requireRole } from "@/lib/session";
import { generateProcess, type GenProcess } from "@/lib/ai";
import { createApprovalRequest } from "@/lib/approval";
import { resolveOrgChain } from "@/lib/orgchart";
import type { ApprovalKind, NodeType, Prisma } from "@prisma/client";

function nodeConfig(n: GenProcess["nodes"][number]): {
  approvalKind: ApprovalKind | null;
  config: Prisma.InputJsonValue;
} {
  if (n.type === "TASK") {
    return {
      approvalKind: null,
      config: { assignee: { kind: "RUNTIME_INPUT", description: n.assigneeDescription ?? "담당자" } },
    };
  }
  if (n.type === "APPROVAL") {
    if (n.approvalKind === "COST") {
      return { approvalKind: "COST", config: { assignee: { kind: "AMOUNT_TIER", amountField: n.amountField ?? "amount" } } };
    }
    return { approvalKind: "GENERAL", config: { assignee: { kind: "ORG_RELATIVE", relation: "MANAGER", levels: 1 } } };
  }
  if (n.type === "AUTOMATION") {
    return { approvalKind: null, config: { automation: { action: n.automationAction ?? "notify", params: {} } } };
  }
  return { approvalKind: null, config: {} };
}

/** Generate a process graph from a natural-language manual and persist as DRAFT. */
export async function generateAndCreate(formData: FormData) {
  const { tenant, user } = await requireContext();
  const manual = String(formData.get("manual") ?? "").trim();
  if (!manual) redirect("/processes/new?error=empty");

  const gen = await generateProcess(manual);

  // dedupe node keys
  const seen = new Set<string>();
  for (const n of gen.nodes) {
    let k = n.key || "node";
    while (seen.has(k)) k = `${k}-2`;
    n.key = k;
    seen.add(k);
  }

  const def = await prisma.$transaction(async (tx) => {
    const definition = await tx.processDefinition.create({
      data: {
        tenantId: tenant.id,
        name: gen.name || "새 프로세스",
        description: gen.description,
        sourceManual: manual,
        formSchema: gen.formFields as Prisma.InputJsonValue,
        status: "DRAFT",
        createdById: user.id,
      },
    });
    const idByKey = new Map<string, string>();
    for (const n of gen.nodes) {
      const { approvalKind, config } = nodeConfig(n);
      const created = await tx.processNode.create({
        data: {
          tenantId: tenant.id,
          definitionId: definition.id,
          key: n.key,
          type: n.type as NodeType,
          name: n.name,
          approvalKind,
          config,
        },
      });
      idByKey.set(n.key, created.id);
    }
    for (const [i, e] of gen.edges.entries()) {
      const from = idByKey.get(e.from);
      const to = idByKey.get(e.to);
      if (!from || !to) continue;
      const condition =
        e.conditionField && e.conditionOp
          ? { field: e.conditionField, op: e.conditionOp, value: coerce(e.conditionValue) }
          : {};
      await tx.processEdge.create({
        data: {
          tenantId: tenant.id,
          definitionId: definition.id,
          fromNodeId: from,
          toNodeId: to,
          label: e.label ?? null,
          condition: condition as Prisma.InputJsonValue,
          order: i,
        },
      });
    }
    return definition;
  });

  redirect(`/processes/${def.id}`);
}

function coerce(v?: string): unknown {
  if (v == null) return v;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

async function editableDefinition(tenantId: string, definitionId: string) {
  const def = await prisma.processDefinition.findFirst({ where: { id: definitionId, tenantId } });
  if (!def) throw new Error("프로세스를 찾을 수 없습니다");
  if (def.status !== "DRAFT" && def.status !== "REJECTED")
    throw new Error("초안/반려 상태에서만 편집할 수 있습니다");
  return def;
}

export async function updateDefinitionMeta(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  await editableDefinition(tenant.id, id);
  await prisma.processDefinition.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "") || null,
      goalId: String(formData.get("goalId") ?? "") || null,
    },
  });
  revalidatePath(`/processes/${id}`);
}

export async function addNode(formData: FormData) {
  const { tenant } = await requireContext();
  const definitionId = String(formData.get("definitionId") ?? "");
  await editableDefinition(tenant.id, definitionId);
  const type = String(formData.get("type") ?? "TASK") as NodeType;
  const name = String(formData.get("name") ?? "").trim() || type;
  const key = `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
  let approvalKind: ApprovalKind | null = null;
  let config: Prisma.InputJsonValue = {};
  if (type === "TASK") config = { assignee: { kind: "RUNTIME_INPUT", description: "담당자" } };
  if (type === "APPROVAL") {
    approvalKind = (String(formData.get("approvalKind") ?? "GENERAL") as ApprovalKind);
    config =
      approvalKind === "COST"
        ? { assignee: { kind: "AMOUNT_TIER", amountField: "amount" } }
        : { assignee: { kind: "ORG_RELATIVE", relation: "MANAGER", levels: 1 } };
  }
  if (type === "AUTOMATION") config = { automation: { action: "notify", params: {} } };
  await prisma.processNode.create({
    data: { tenantId: tenant.id, definitionId, key, type, name, approvalKind, config },
  });
  revalidatePath(`/processes/${definitionId}/edit`);
}

export async function updateNode(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const node = await prisma.processNode.findFirst({ where: { id, tenantId: tenant.id } });
  if (!node) return;
  await editableDefinition(tenant.id, node.definitionId);
  const name = String(formData.get("name") ?? "").trim() || node.name;
  const cfg = (node.config as Record<string, unknown>) ?? {};
  if (node.type === "TASK") {
    cfg.assignee = { kind: "RUNTIME_INPUT", description: String(formData.get("assigneeDescription") ?? "담당자") };
  }
  if (node.type === "APPROVAL") {
    const kind = String(formData.get("approvalKind") ?? node.approvalKind ?? "GENERAL") as ApprovalKind;
    await prisma.processNode.update({ where: { id }, data: { approvalKind: kind } });
    cfg.assignee =
      kind === "COST"
        ? { kind: "AMOUNT_TIER", amountField: String(formData.get("amountField") ?? "amount") }
        : { kind: "ORG_RELATIVE", relation: "MANAGER", levels: Number(formData.get("levels") ?? 1) };
  }
  await prisma.processNode.update({ where: { id }, data: { name, config: cfg as Prisma.InputJsonValue } });
  revalidatePath(`/processes/${node.definitionId}/edit`);
}

export async function deleteNode(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const node = await prisma.processNode.findFirst({ where: { id, tenantId: tenant.id } });
  if (!node) return;
  await editableDefinition(tenant.id, node.definitionId);
  await prisma.processNode.delete({ where: { id } }); // cascades edges
  revalidatePath(`/processes/${node.definitionId}/edit`);
}

export async function addEdge(formData: FormData) {
  const { tenant } = await requireContext();
  const definitionId = String(formData.get("definitionId") ?? "");
  await editableDefinition(tenant.id, definitionId);
  const fromNodeId = String(formData.get("fromNodeId") ?? "");
  const toNodeId = String(formData.get("toNodeId") ?? "");
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
  const field = String(formData.get("conditionField") ?? "").trim();
  const op = String(formData.get("conditionOp") ?? "").trim();
  const value = String(formData.get("conditionValue") ?? "").trim();
  const condition = field && op ? { field, op, value: coerce(value) } : {};
  const count = await prisma.processEdge.count({ where: { definitionId } });
  await prisma.processEdge.create({
    data: {
      tenantId: tenant.id,
      definitionId,
      fromNodeId,
      toNodeId,
      label: String(formData.get("label") ?? "") || null,
      condition: condition as Prisma.InputJsonValue,
      order: count,
    },
  });
  revalidatePath(`/processes/${definitionId}/edit`);
}

export async function deleteEdge(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const edge = await prisma.processEdge.findFirst({ where: { id, tenantId: tenant.id } });
  if (!edge) return;
  await editableDefinition(tenant.id, edge.definitionId);
  await prisma.processEdge.delete({ where: { id } });
  revalidatePath(`/processes/${edge.definitionId}/edit`);
}

/** Submit a DRAFT for registration approval up the author's reporting line. */
export async function submitForApproval(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const def = await editableDefinition(tenant.id, id);

  await prisma.$transaction(async (tx) => {
    const approvers = await resolveOrgChain(tx, user.id, {}); // full chain (multi-step)
    const req = await createApprovalRequest(tx, {
      tenantId: tenant.id,
      subjectType: "PROCESS_REGISTRATION",
      subjectId: def.id,
      routingType: "ORG_CHAIN",
      requesterId: user.id,
      approverIds: approvers,
      definitionId: def.id,
      note: `[프로세스 등록 승인] ${def.name}`,
    });
    if (req.status === "APPROVED") {
      // no approvers in chain → auto-activate
      await tx.processDefinition.update({ where: { id: def.id }, data: { status: "ACTIVE" } });
    } else {
      await tx.processDefinition.update({ where: { id: def.id }, data: { status: "PENDING" } });
    }
  });
  revalidatePath(`/processes/${id}`);
  redirect(`/processes/${id}`);
}

export async function archiveDefinition(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.processDefinition.updateMany({
    where: { id, tenantId: tenant.id },
    data: { status: "ARCHIVED" },
  });
  revalidatePath("/processes");
}
