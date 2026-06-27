"use server";

import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import type { ApprovalKind, NodeType, Prisma } from "@prisma/client";

/**
 * Graph-editor server actions. Unlike actions/process.ts (form + revalidate),
 * these return the affected entity so the drag-and-drop client can update its
 * local state optimistically without a full refresh.
 */

async function guard(definitionId: string) {
  const { tenant } = await requireContext();
  const def = await prisma.processDefinition.findFirst({ where: { id: definitionId, tenantId: tenant.id } });
  if (!def) throw new Error("프로세스를 찾을 수 없습니다");
  if (def.status !== "DRAFT" && def.status !== "REJECTED") throw new Error("초안/반려 상태에서만 편집할 수 있습니다");
  return tenant.id;
}

function coerce(v?: string): unknown {
  if (v == null || v === "") return v;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

export interface EditorNode {
  id: string;
  key: string;
  type: NodeType;
  name: string;
  approvalKind: ApprovalKind | null;
  config: Record<string, unknown>;
  posX: number;
  posY: number;
}
export interface EditorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  condition: Record<string, unknown>;
}

export async function moveNode(definitionId: string, nodeId: string, posX: number, posY: number) {
  const tenantId = await guard(definitionId);
  await prisma.processNode.updateMany({
    where: { id: nodeId, tenantId, definitionId },
    data: { posX: Math.round(posX), posY: Math.round(posY) },
  });
}

export async function createNode(
  definitionId: string,
  type: NodeType,
  posX: number,
  posY: number,
): Promise<EditorNode> {
  const tenantId = await guard(definitionId);
  const key = `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
  let approvalKind: ApprovalKind | null = null;
  let config: Prisma.InputJsonValue = {};
  const name =
    type === "TASK" ? "새 작업" : type === "APPROVAL" ? "새 결재" :
    type === "AUTOMATION" ? "자동 처리" : type === "CONDITION" ? "분기" :
    type === "END" ? "종료" : type;
  if (type === "TASK") config = { assignee: { kind: "RUNTIME_INPUT", description: "담당자" } };
  if (type === "APPROVAL") { approvalKind = "GENERAL"; config = { assignee: { kind: "ORG_RELATIVE", relation: "MANAGER", levels: 1 } }; }
  if (type === "AUTOMATION") config = { automation: { action: "notify", params: {} } };
  const n = await prisma.processNode.create({
    data: { tenantId, definitionId, key, type, name, approvalKind, config, posX: Math.round(posX), posY: Math.round(posY) },
  });
  return { id: n.id, key: n.key, type: n.type, name: n.name, approvalKind: n.approvalKind, config: (n.config as Record<string, unknown>) ?? {}, posX: n.posX, posY: n.posY };
}

export async function renameAndConfigureNode(
  nodeId: string,
  patch: { name?: string; approvalKind?: ApprovalKind; assigneeDescription?: string; amountField?: string; levels?: number; automationAction?: string },
): Promise<EditorNode> {
  const { tenant } = await requireContext();
  const node = await prisma.processNode.findFirst({ where: { id: nodeId, tenantId: tenant.id } });
  if (!node) throw new Error("노드를 찾을 수 없습니다");
  await guard(node.definitionId);
  const cfg = (node.config as Record<string, unknown>) ?? {};
  let approvalKind = node.approvalKind;
  if (node.type === "TASK") {
    cfg.assignee = { kind: "RUNTIME_INPUT", description: patch.assigneeDescription ?? (cfg.assignee as { description?: string })?.description ?? "담당자" };
  }
  if (node.type === "APPROVAL") {
    approvalKind = patch.approvalKind ?? node.approvalKind ?? "GENERAL";
    cfg.assignee = approvalKind === "COST"
      ? { kind: "AMOUNT_TIER", amountField: patch.amountField ?? "amount" }
      : { kind: "ORG_RELATIVE", relation: "MANAGER", levels: patch.levels ?? 1 };
  }
  if (node.type === "AUTOMATION") {
    cfg.automation = { action: patch.automationAction ?? "notify", params: {} };
  }
  const n = await prisma.processNode.update({
    where: { id: nodeId },
    data: { name: patch.name ?? node.name, approvalKind, config: cfg as Prisma.InputJsonValue },
  });
  return { id: n.id, key: n.key, type: n.type, name: n.name, approvalKind: n.approvalKind, config: (n.config as Record<string, unknown>) ?? {}, posX: n.posX, posY: n.posY };
}

export async function removeNode(nodeId: string) {
  const { tenant } = await requireContext();
  const node = await prisma.processNode.findFirst({ where: { id: nodeId, tenantId: tenant.id } });
  if (!node) return;
  await guard(node.definitionId);
  if (node.type === "START") throw new Error("START 노드는 삭제할 수 없습니다");
  await prisma.processNode.delete({ where: { id: nodeId } }); // cascades edges
}

export async function connectNodes(definitionId: string, fromNodeId: string, toNodeId: string): Promise<EditorEdge | null> {
  const tenantId = await guard(definitionId);
  if (fromNodeId === toNodeId) return null;
  const exists = await prisma.processEdge.findFirst({ where: { definitionId, fromNodeId, toNodeId } });
  if (exists) return null;
  const count = await prisma.processEdge.count({ where: { definitionId } });
  const e = await prisma.processEdge.create({
    data: { tenantId, definitionId, fromNodeId, toNodeId, order: count, condition: {} },
  });
  return { id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, label: e.label, condition: {} };
}

export async function configureEdge(
  edgeId: string,
  patch: { label?: string; field?: string; op?: string; value?: string },
): Promise<EditorEdge> {
  const { tenant } = await requireContext();
  const edge = await prisma.processEdge.findFirst({ where: { id: edgeId, tenantId: tenant.id } });
  if (!edge) throw new Error("연결을 찾을 수 없습니다");
  await guard(edge.definitionId);
  const condition = patch.field && patch.op ? { field: patch.field, op: patch.op, value: coerce(patch.value) } : {};
  const e = await prisma.processEdge.update({
    where: { id: edgeId },
    data: { label: patch.label || null, condition: condition as Prisma.InputJsonValue },
  });
  return { id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, label: e.label, condition: (e.condition as Record<string, unknown>) ?? {} };
}

export async function removeEdge(edgeId: string) {
  const { tenant } = await requireContext();
  const edge = await prisma.processEdge.findFirst({ where: { id: edgeId, tenantId: tenant.id } });
  if (!edge) return;
  await guard(edge.definitionId);
  await prisma.processEdge.delete({ where: { id: edgeId } });
}
