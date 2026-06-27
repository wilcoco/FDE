"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { decideApprovalStep } from "@/lib/approval";
import { onNodeApprovalResolved, applyInstanceChange } from "@/lib/engine";

/**
 * Decide one approval step. The common module records the decision; this action
 * orchestrates the side effects when the request reaches a terminal state,
 * branching by subject type (registration / node approval / instance change).
 */
export async function decideApproval(formData: FormData) {
  const { tenant, user } = await requireContext();
  const requestId = String(formData.get("requestId") ?? "");
  const approve = String(formData.get("decision") ?? "") === "approve";
  const comment = String(formData.get("comment") ?? "") || undefined;

  await prisma.$transaction(async (tx) => {
    const result = await decideApprovalStep(tx, {
      tenantId: tenant.id,
      requestId,
      approverId: user.id,
      approve,
      comment,
    });
    if (!result.resolved) return;

    const req = result.request;
    if (req.subjectType === "PROCESS_REGISTRATION" && req.definitionId) {
      await tx.processDefinition.update({
        where: { id: req.definitionId },
        data: { status: result.approved ? "ACTIVE" : "REJECTED" },
      });
    } else if (req.subjectType === "NODE_APPROVAL" && req.nodeInstanceId) {
      await onNodeApprovalResolved(tx, tenant.id, req.nodeInstanceId, result.approved);
    } else if (req.subjectType === "INSTANCE_CHANGE" && req.changeId) {
      await tx.instanceChange.update({
        where: { id: req.changeId },
        data: { status: result.approved ? "APPROVED" : "REJECTED" },
      });
      if (result.approved) {
        await applyInstanceChange(tx, tenant.id, req.changeId);
      }
    }
  });

  revalidatePath("/inbox");
}

export async function markNotificationsRead() {
  const { tenant, user } = await requireContext();
  await prisma.notification.updateMany({
    where: { tenantId: tenant.id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/inbox");
}
