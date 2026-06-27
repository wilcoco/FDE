"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import {
  startInstance,
  completeTask,
  issueDirective,
} from "@/lib/engine";
import { createApprovalRequest } from "@/lib/approval";
import { resolveOrgChain, managerChain } from "@/lib/orgchart";
import type { InstanceChangeMode, Prisma } from "@prisma/client";

/** Launch (기안) an ACTIVE process; assign TASK people and fill the form. */
export async function startInstanceAction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const definitionId = String(formData.get("definitionId") ?? "");
  const def = await prisma.processDefinition.findFirst({
    where: { id: definitionId, tenantId: tenant.id },
  });
  if (!def || def.status !== "ACTIVE") redirect("/processes");

  const title = String(formData.get("title") ?? "").trim() || def!.name;
  const data: Record<string, unknown> = {};
  const assignments: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    const val = String(v);
    if (k.startsWith("f_")) {
      const n = Number(val);
      data[k.slice(2)] = val !== "" && !Number.isNaN(n) ? n : val;
    } else if (k.startsWith("a_") && val) {
      assignments[k.slice(2)] = val;
    }
  }

  const instance = await startInstance({
    tenantId: tenant.id,
    definitionId,
    title,
    data,
    initiatorId: user.id,
    assignments,
  });
  redirect(`/instances/${instance.id}`);
}

export async function completeTaskAction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const nodeRunId = String(formData.get("nodeRunId") ?? "");
  await completeTask({ tenantId: tenant.id, nodeRunId, userId: user.id });
  const run = await prisma.nodeInstance.findUnique({ where: { id: nodeRunId } });
  if (run) revalidatePath(`/instances/${run.instanceId}`);
  revalidatePath("/inbox");
}

export async function addWorkLog(formData: FormData) {
  const { tenant, user } = await requireContext();
  const nodeInstanceId = String(formData.get("nodeInstanceId") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const run = await prisma.nodeInstance.findFirst({ where: { id: nodeInstanceId, tenantId: tenant.id } });
  if (!run) return;
  await prisma.workLog.create({
    data: {
      tenantId: tenant.id,
      nodeInstanceId,
      authorId: user.id,
      content,
      status: (String(formData.get("status") ?? "IN_PROGRESS") as "IN_PROGRESS" | "SUBMITTED"),
    },
  });
  revalidatePath(`/instances/${run.instanceId}`);
}

export async function addComment(formData: FormData) {
  const { tenant, user } = await requireContext();
  const nodeInstanceId = String(formData.get("nodeInstanceId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const run = await prisma.nodeInstance.findFirst({ where: { id: nodeInstanceId, tenantId: tenant.id } });
  if (!run) return;
  await prisma.comment.create({
    data: {
      tenantId: tenant.id,
      nodeInstanceId,
      workLogId: String(formData.get("workLogId") ?? "") || null,
      authorId: user.id,
      body,
    },
  });
  revalidatePath(`/instances/${run.instanceId}`);
}

export async function issueDirectiveAction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const nodeInstanceId = String(formData.get("nodeInstanceId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const run = await prisma.nodeInstance.findFirst({ where: { id: nodeInstanceId, tenantId: tenant.id } });
  if (!run) return;

  // optional org-chart restriction: only the assignee's superiors may direct
  if (tenant.directiveRestrictedToSuperior && run.assigneeId && run.assigneeId !== user.id) {
    const chain = await managerChain(prisma, run.assigneeId);
    if (!chain.some((m) => m.id === user.id)) {
      throw new Error("이 조직에서는 조직도상 상급자만 업무 지시를 내릴 수 있습니다.");
    }
  }

  await issueDirective({ tenantId: tenant.id, nodeInstanceId, issuerId: user.id, body });
  revalidatePath(`/instances/${run.instanceId}`);
}

/** Request an ad-hoc collaboration task (사후 프로세스 수정) — routes for approval. */
export async function requestInstanceChange(formData: FormData) {
  const { tenant, user } = await requireContext();
  const instanceId = String(formData.get("instanceId") ?? "");
  const instance = await prisma.processInstance.findFirst({ where: { id: instanceId, tenantId: tenant.id } });
  if (!instance) return;

  const newTaskName = String(formData.get("newTaskName") ?? "").trim();
  if (!newTaskName) return;
  const mode = (String(formData.get("mode") ?? "PARALLEL") as InstanceChangeMode);
  const afterNodeKey = String(formData.get("afterNodeKey") ?? "") || null;
  const newTaskAssigneeId = String(formData.get("newTaskAssigneeId") ?? "") || null;
  const description = String(formData.get("description") ?? "") || null;

  await prisma.$transaction(async (tx) => {
    const change = await tx.instanceChange.create({
      data: {
        tenantId: tenant.id,
        instanceId,
        requesterId: user.id,
        mode,
        afterNodeKey,
        newTaskName,
        newTaskAssigneeId,
        description,
        status: "PENDING",
      },
    });
    const approvers = await resolveOrgChain(tx, user.id, {}); // process approval 체계
    const req = await createApprovalRequest(tx, {
      tenantId: tenant.id,
      subjectType: "INSTANCE_CHANGE",
      subjectId: change.id,
      routingType: "ORG_CHAIN",
      requesterId: user.id,
      approverIds: approvers,
      changeId: change.id,
      note: `[협조업무 추가 승인] ${newTaskName}`,
    });
    if (req.status === "APPROVED") {
      // no approver in chain → apply immediately
      await tx.instanceChange.update({ where: { id: change.id }, data: { status: "APPROVED" } });
      const { applyInstanceChange } = await import("@/lib/engine");
      await applyInstanceChange(tx as unknown as Prisma.TransactionClient, tenant.id, change.id);
    }
  });
  revalidatePath(`/instances/${instanceId}`);
}
