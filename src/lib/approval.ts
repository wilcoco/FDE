import { prisma } from "./db";
import { notify } from "./notify";
import type {
  ApprovalRequest,
  ApprovalRoutingType,
  ApprovalSubjectType,
  Prisma,
} from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Common approval module
 * ----------------------------------------------------------------------------
 * One reusable engine for every approval in the product: process registration,
 * in-process APPROVAL nodes (general & cost), and ad-hoc 협조업무 changes.
 * Callers resolve the ordered approver list (via orgchart.ts) and hand it here;
 * this module just records the steps and drives them in order.
 */

export async function createApprovalRequest(
  db: Db,
  args: {
    tenantId: string;
    subjectType: ApprovalSubjectType;
    subjectId: string;
    routingType: ApprovalRoutingType;
    requesterId: string;
    approverIds: string[];
    amount?: number;
    note?: string;
    // typed back-links
    definitionId?: string;
    nodeInstanceId?: string;
    changeId?: string;
  },
): Promise<ApprovalRequest> {
  // de-dupe while preserving order; an empty chain auto-approves
  const seen = new Set<string>();
  const approvers = args.approverIds.filter((id) =>
    seen.has(id) ? false : (seen.add(id), true),
  );

  const request = await db.approvalRequest.create({
    data: {
      tenantId: args.tenantId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      routingType: args.routingType,
      requesterId: args.requesterId,
      amount: args.amount,
      note: args.note,
      definitionId: args.definitionId,
      nodeInstanceId: args.nodeInstanceId,
      changeId: args.changeId,
      status: approvers.length === 0 ? "APPROVED" : "PENDING",
      decidedAt: approvers.length === 0 ? new Date() : null,
      currentStep: 0,
      steps: {
        create: approvers.map((approverId, i) => ({
          tenantId: args.tenantId,
          order: i,
          approverId,
          status: "PENDING" as const,
        })),
      },
    },
  });

  if (approvers.length > 0) {
    await notify(db, {
      tenantId: args.tenantId,
      userId: approvers[0],
      type: "APPROVAL_REQUEST",
      title: "결재 요청이 도착했습니다",
      body: args.note ?? undefined,
      link: "/inbox",
    });
  }
  return request;
}

export interface DecisionResult {
  request: ApprovalRequest;
  resolved: boolean; // request reached a terminal state this call
  approved: boolean; // terminal state is APPROVED
}

/**
 * Record one approver's decision on the *current* step and advance.
 * Reject terminates the request; approve advances to the next step (or
 * resolves the request when the chain is exhausted).
 */
export async function decideApprovalStep(
  db: Db,
  args: {
    tenantId: string;
    requestId: string;
    approverId: string;
    approve: boolean;
    comment?: string;
  },
): Promise<DecisionResult> {
  const request = await db.approvalRequest.findFirst({
    where: { id: args.requestId, tenantId: args.tenantId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!request) throw new Error("승인 요청을 찾을 수 없습니다");
  if (request.status !== "PENDING")
    throw new Error("이미 종결된 결재입니다");

  const step = request.steps[request.currentStep];
  if (!step || step.approverId !== args.approverId || step.status !== "PENDING") {
    throw new Error("현재 결재 차례가 아닙니다");
  }

  await db.approvalStep.update({
    where: { id: step.id },
    data: {
      status: args.approve ? "APPROVED" : "REJECTED",
      comment: args.comment,
      decidedAt: new Date(),
    },
  });

  if (!args.approve) {
    const updated = await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    await notify(db, {
      tenantId: args.tenantId,
      userId: request.requesterId,
      type: "APPROVAL_REJECTED",
      title: "결재가 반려되었습니다",
      body: args.comment ?? undefined,
      link: "/inbox",
    });
    return { request: updated, resolved: true, approved: false };
  }

  const nextIndex = request.currentStep + 1;
  if (nextIndex >= request.steps.length) {
    const updated = await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", currentStep: nextIndex, decidedAt: new Date() },
    });
    await notify(db, {
      tenantId: args.tenantId,
      userId: request.requesterId,
      type: "APPROVAL_APPROVED",
      title: "결재가 승인되었습니다",
      link: "/inbox",
    });
    return { request: updated, resolved: true, approved: true };
  }

  const updated = await db.approvalRequest.update({
    where: { id: request.id },
    data: { currentStep: nextIndex },
  });
  await notify(db, {
    tenantId: args.tenantId,
    userId: request.steps[nextIndex].approverId,
    type: "APPROVAL_REQUEST",
    title: "결재 요청이 도착했습니다",
    link: "/inbox",
  });
  return { request: updated, resolved: false, approved: false };
}
