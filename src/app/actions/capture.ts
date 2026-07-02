"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { generateMilestones, regenerateMilestones } from "@/lib/ai";
import { notify, notifyEmail } from "@/lib/notify";
import { atLeast } from "@/lib/rbac";
import { resolveStatusChange, canReview } from "@/lib/milestone-rules";
import { runSynthesisForTenant, maybeAutoSynthesize } from "@/lib/synthesis";
import type { MilestoneStatus, Prisma } from "@prisma/client";

/** Capture an owner instruction → AI decomposes into coarse milestones (꼭지). */
export async function captureInstruction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) redirect("/capture?error=empty");

  const gen = await generateMilestones(rawText);

  const instruction = await prisma.$transaction(async (tx) => {
    const inst = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText,
        summary: gen.summary,
        source: "TEXT",
      },
    });
    await tx.milestone.createMany({
      data: gen.milestones.map((m, i) => ({
        tenantId: tenant.id,
        instructionId: inst.id,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult || null,
        status: "PENDING" as MilestoneStatus,
        activatedAt: null,
        proof: [] as Prisma.InputJsonValue,
      })),
    });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "INSTRUCTION_CAPTURED", target: inst.id },
    });
    return inst;
  });

  // strategic coherence: re-synthesize in the background every few instructions
  void maybeAutoSynthesize(tenant.id, user.id);

  redirect(`/instructions/${instruction.id}`);
}

/** Re-generate the milestone set from additional owner guidance (refine loop). */
export async function regenerateInstruction(formData: FormData) {
  const { tenant } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const feedback = String(formData.get("feedback") ?? "").trim();
  if (!feedback) return;

  const inst = await prisma.instruction.findFirst({
    where: { id: instructionId, tenantId: tenant.id },
    include: { milestones: { orderBy: { order: "asc" } } },
  });
  if (!inst) return;

  const gen = await regenerateMilestones(
    inst.rawText,
    inst.milestones.map((m) => m.title),
    feedback,
  );

  await prisma.$transaction(async (tx) => {
    await tx.milestone.deleteMany({ where: { instructionId, tenantId: tenant.id } });
    await tx.milestone.createMany({
      data: gen.milestones.map((m, i) => ({
        tenantId: tenant.id,
        instructionId,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult || null,
        status: "PENDING" as MilestoneStatus,
        activatedAt: null,
        proof: [] as Prisma.InputJsonValue,
      })),
    });
    await tx.instruction.update({
      where: { id: instructionId },
      data: { summary: gen.summary, rawText: `${inst.rawText}\n\n[추가 지침] ${feedback}` },
    });
  });
  revalidatePath(`/instructions/${instructionId}`);
}

async function ownMilestone(tenantId: string, milestoneId: string) {
  const m = await prisma.milestone.findFirst({
    where: { id: milestoneId, tenantId },
    include: { instruction: { select: { id: true, authorId: true, summary: true } } },
  });
  if (!m) throw new Error("꼭지를 찾을 수 없습니다");
  return m;
}

export async function updateMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.update({
    where: { id },
    data: {
      title: String(formData.get("title") ?? m.title).trim() || m.title,
      expectedResult: String(formData.get("expectedResult") ?? "") || null,
      dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))) : null,
    },
  });
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function assignMilestoneOwner(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "") || null;
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.update({ where: { id }, data: { ownerId } });

  if (ownerId && ownerId !== user.id) {
    const entry = {
      tenantId: tenant.id, userId: ownerId, type: "MILESTONE_ASSIGNED",
      title: `꼭지가 배정되었습니다: ${m.title}`,
      body: m.status === "PENDING" ? "대기 상태 — 순서가 되면 시작됩니다." : m.instruction.summary ?? undefined,
      link: `/instructions/${m.instructionId}`,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
  }
  revalidatePath(`/instructions/${m.instructionId}`);
}

/** Activate the next PENDING milestone after `m` completes (light sequencing). */
async function activateNext(
  tx: Prisma.TransactionClient,
  tenantId: string,
  m: { instructionId: string; order: number },
) {
  const next = await tx.milestone.findFirst({
    where: { tenantId, instructionId: m.instructionId, status: "PENDING", order: { gt: m.order } },
    orderBy: { order: "asc" },
  });
  if (!next) return null;
  await tx.milestone.update({
    where: { id: next.id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
  if (next.ownerId) {
    await notify(tx, {
      tenantId, userId: next.ownerId, type: "MILESTONE_ASSIGNED",
      title: `다음 꼭지가 시작되었습니다: ${next.title}`,
      link: `/instructions/${m.instructionId}`,
    });
  }
  return next;
}

/**
 * Status change through the review gate: an assignee's "완료" is a CLAIM —
 * it becomes REVIEW until the instruction author (or an admin) confirms it.
 */
export async function setMilestoneStatus(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("status") ?? "PENDING") as MilestoneStatus;
  const m = await ownMilestone(tenant.id, id);

  const actor = {
    isAuthor: m.instruction.authorId === user.id,
    isAdmin: atLeast(user.role, "ADMIN"),
  };
  const change = resolveStatusChange(requested, actor);

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id },
      data: {
        status: change.status,
        activatedAt: change.status === "ACTIVE" && !m.activatedAt ? new Date() : m.activatedAt,
        doneAt: change.status === "DONE" ? new Date() : null,
        submittedAt: change.status === "REVIEW" ? new Date() : m.submittedAt,
        // a direct DONE (author/admin) settles any open rework note
        returnNote: change.status === "DONE" ? null : m.returnNote,
      },
    });
    if (change.status === "DONE") {
      await activateNext(tx, tenant.id, m);
    }
    // notify once per submission — re-submitting an already-REVIEW item is silent
    if (change.needsReview && m.instruction.authorId !== user.id && m.status !== "REVIEW") {
      await notify(tx, {
        tenantId: tenant.id, userId: m.instruction.authorId, type: "MILESTONE_REVIEW",
        title: `검수 요청: ${m.title}`,
        body: `${user.name} 님이 완료를 제출했습니다. 기대 결과와 맞는지 확인하세요.`,
        link: `/instructions/${m.instructionId}`,
      });
    }
  });

  if (change.needsReview && m.instruction.authorId !== user.id && m.status !== "REVIEW") {
    void notifyEmail({
      tenantId: tenant.id, userId: m.instruction.authorId, type: "MILESTONE_REVIEW",
      title: `검수 요청: ${m.title}`,
      body: `${user.name} 님이 완료를 제출했습니다.`,
      link: `/instructions/${m.instructionId}`,
    }).catch(() => {});
  }

  revalidatePath(`/instructions/${m.instructionId}`);
  revalidatePath("/inbox");
}

/** Author/admin confirms a submitted milestone: REVIEW → DONE (+ next starts). */
export async function approveMilestone(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const m = await ownMilestone(tenant.id, id);
  const actor = {
    isAuthor: m.instruction.authorId === user.id,
    isAdmin: atLeast(user.role, "ADMIN"),
  };
  if (!canReview(actor) || m.status !== "REVIEW") return;

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id },
      data: { status: "DONE", doneAt: new Date(), returnNote: null },
    });
    await activateNext(tx, tenant.id, m);
    if (m.ownerId && m.ownerId !== user.id) {
      await notify(tx, {
        tenantId: tenant.id, userId: m.ownerId, type: "MILESTONE_APPROVED",
        title: `확인 완료 ✅: ${m.title}`,
        body: "제출한 결과가 확인되었습니다.",
        link: `/instructions/${m.instructionId}`,
      });
    }
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "MILESTONE_APPROVED", target: m.id },
    });
  });

  revalidatePath(`/instructions/${m.instructionId}`);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

/** Author/admin returns a submitted milestone for rework: REVIEW → ACTIVE + note. */
export async function returnMilestone(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const m = await ownMilestone(tenant.id, id);
  const actor = {
    isAuthor: m.instruction.authorId === user.id,
    isAdmin: atLeast(user.role, "ADMIN"),
  };
  if (!canReview(actor) || m.status !== "REVIEW") return;

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id },
      data: {
        status: "ACTIVE",
        returnNote: note || "기대 결과와 다릅니다. 보완해 주세요.",
        submittedAt: null,
      },
    });
    if (m.ownerId) {
      await notify(tx, {
        tenantId: tenant.id, userId: m.ownerId, type: "MILESTONE_RETURNED",
        title: `반려됨 🔁: ${m.title}`,
        body: note || "기대 결과와 다릅니다. 보완해 주세요.",
        link: `/instructions/${m.instructionId}`,
      });
    }
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "MILESTONE_RETURNED", target: m.id },
    });
  });

  if (m.ownerId) {
    void notifyEmail({
      tenantId: tenant.id, userId: m.ownerId, type: "MILESTONE_RETURNED",
      title: `반려됨: ${m.title}`,
      body: note || "기대 결과와 다릅니다. 보완해 주세요.",
      link: `/instructions/${m.instructionId}`,
    }).catch(() => {});
  }

  revalidatePath(`/instructions/${m.instructionId}`);
  revalidatePath("/inbox");
}

export async function addMilestoneProof(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const type = String(formData.get("type") ?? "note");
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  const m = await ownMilestone(tenant.id, id);
  const proof = Array.isArray(m.proof) ? (m.proof as unknown[]) : [];
  proof.push({ type, value, by: user.name, at: new Date().toISOString() });
  await prisma.milestone.update({ where: { id }, data: { proof: proof as Prisma.InputJsonValue } });

  // activity feed for the instruction author (opt-out via 알림 설정 > 진행 기록)
  if (m.instruction.authorId !== user.id) {
    const entry = {
      tenantId: tenant.id, userId: m.instruction.authorId, type: "PROOF_ADDED",
      title: `진행 기록: ${m.title}`,
      body: `${user.name}: ${value.slice(0, 120)}`,
      link: `/instructions/${m.instructionId}`,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
  }
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function addMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const inst = await prisma.instruction.findFirst({ where: { id: instructionId, tenantId: tenant.id } });
  if (!inst) return;
  const count = await prisma.milestone.count({ where: { instructionId } });
  await prisma.milestone.create({
    data: { tenantId: tenant.id, instructionId, order: count, title, status: "PENDING", proof: [] as Prisma.InputJsonValue },
  });
  revalidatePath(`/instructions/${instructionId}`);
}

export async function deleteMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.delete({ where: { id } });
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function linkInstructionObjective(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const objectiveId = String(formData.get("objectiveId") ?? "") || null;
  await prisma.instruction.updateMany({ where: { id, tenantId: tenant.id }, data: { objectiveId } });
  revalidatePath(`/instructions/${id}`);
}

export async function archiveInstruction(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  await prisma.instruction.updateMany({ where: { id, tenantId: tenant.id }, data: { status: "ARCHIVED" } });
  revalidatePath("/instructions");
  redirect("/instructions");
}

/** Run the upward strategic-coherence synthesis over the instruction stream. */
export async function runSynthesis() {
  const { tenant, user } = await requireContext();
  await runSynthesisForTenant(tenant.id, user.id);
  revalidatePath("/strategy");
}
