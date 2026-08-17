"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { generateMilestones, regenerateMilestones, draftAskMail } from "@/lib/ai";
import { notify, notifyEmail } from "@/lib/notify";
import { atLeast } from "@/lib/rbac";
import { resolveStatusChange, canReview } from "@/lib/milestone-rules";
import { runSynthesisForTenant, maybeAutoSynthesize } from "@/lib/synthesis";
import { composeAndSend } from "./mail";
import type { MilestoneStatus, Prisma } from "@prisma/client";

/** Capture an owner instruction → AI decomposes into coarse milestones (꼭지). */
export async function captureInstruction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) redirect("/capture?error=empty");

  // (메일 발송 지시는 previewTasks → finalizeCapture 2단계 경로가 담당한다 —
  //  일의 전후: 지시자가 꼭지를 확정한 뒤에만 발송된다. 이 함수는 위임 사슬
  //  등 내부 지시 직행 경로.)

  // delegation chain: this instruction may be spawned FROM a milestone the
  // current user is executing — their "do" becomes their own "say" downward.
  const parentMilestoneId = String(formData.get("parentMilestoneId") ?? "") || null;
  let parent: { id: string; title: string; instruction: { authorId: string; id: string } } | null = null;
  if (parentMilestoneId) {
    parent = await prisma.milestone.findFirst({
      where: { id: parentMilestoneId, tenantId: tenant.id },
      select: { id: true, title: true, instruction: { select: { authorId: true, id: true } } },
    });
    if (!parent) redirect("/capture?error=parent");
  }

  const gen = await generateMilestones(rawText);

  const instruction = await prisma.$transaction(async (tx) => {
    const inst = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText,
        summary: gen.summary,
        source: "TEXT",
        parentMilestoneId: parent?.id ?? null,
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

  // upstream visibility: tell the parent instruction's author their milestone
  // was broken down further (mirror, not control — no approval required)
  if (parent && parent.instruction.authorId !== user.id) {
    const entry = {
      tenantId: tenant.id, userId: parent.instruction.authorId, type: "DELEGATED",
      title: `⤵ 꼭지가 하위 지시로 분해되었습니다: ${parent.title}`,
      body: `${user.name}: ${gen.summary ?? rawText.slice(0, 80)}`,
      link: `/instructions/${instruction.id}`,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
  }

  // strategic coherence: re-synthesize in the background every few instructions
  void maybeAutoSynthesize(tenant.id, user.id);

  redirect(`/instructions/${instruction.id}`);
}

/**
 * 1단계 — 분해 미리보기. 지시문을 AI가 꼭지로 나눠 돌려주기만 하고, 아무것도
 * 저장·발송하지 않는다. 지시자가 빼고 고친 뒤 finalizeCapture로 확정한다.
 * (일의 전후: 상대에게 나갈 구조의 최종 결정권은 지시자에게 있다.)
 */
export async function previewTasks(
  formData: FormData,
): Promise<{ summary: string; tasks: { title: string; expectedResult: string | null }[] } | { error: string }> {
  await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) return { error: "지시 내용을 입력해주세요." };
  try {
    const gen = await generateMilestones(rawText);
    return {
      summary: (gen.summary || rawText.split("\n")[0]).slice(0, 100),
      tasks: gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null })),
    };
  } catch {
    return { error: "AI 분해에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }
}

/** 2단계 — 지시자가 확정한 꼭지로 등록(+받는 사람이 있으면 발송). */
export async function finalizeCapture(formData: FormData) {
  const { tenant, user } = await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim().slice(0, 100) || rawText.slice(0, 80);
  if (!rawText) redirect("/capture?error=empty");

  let tasks: { title: string; expectedResult: string | null }[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("tasksJson") ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      tasks = parsed
        .filter((t): t is { title: string; expectedResult?: string | null } =>
          !!t && typeof (t as { title?: unknown }).title === "string" && !!(t as { title: string }).title.trim())
        .map((t) => ({ title: t.title.trim().slice(0, 200), expectedResult: t.expectedResult?.trim?.() || null }))
        .slice(0, 20);
    }
  } catch { /* fall through to single-task fallback */ }
  if (tasks.length === 0) tasks = [{ title: summary, expectedResult: null }];

  if (to) {
    // 메일 지시: 확정된 꼭지 그대로 발송·추적 — composeAndSend는 재분해하지 않는다
    const fd = new FormData();
    fd.set("to", to);
    fd.set("subject", summary);
    fd.set("body", rawText);
    fd.set("individual", "on");
    fd.set("summary", summary);
    fd.set("tasksJson", JSON.stringify(tasks));
    await composeAndSend(fd); // redirects internally
    return;
  }

  // 사내 지시: captureInstruction과 동일 의미론, 꼭지만 지시자 확정본으로
  const instruction = await prisma.$transaction(async (tx) => {
    const inst = await tx.instruction.create({
      data: { tenantId: tenant.id, authorId: user.id, rawText, summary, source: "TEXT" },
    });
    await tx.milestone.createMany({
      data: tasks.map((m, i) => ({
        tenantId: tenant.id,
        instructionId: inst.id,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult,
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

  void maybeAutoSynthesize(tenant.id, user.id);
  redirect(`/instructions/${instruction.id}`);
}

/**
 * 빠른 보내기 — 시나리오 A/C: 간단한 지시는 미리보기 없이 즉시.
 * 받는 사람이 있으면 AI가 제목·본문을 다듬어(분해 아님) 바로 발송하고
 * 답장 대기 상태가 된다. 없으면 꼭지 1개짜리 사내 지시로 즉시 등록.
 * 원본 지시문(rawText)은 어느 경로든 그대로 장부에 남는다.
 */
export async function quickSend(formData: FormData) {
  await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) redirect("/capture?error=empty");
  const to = String(formData.get("to") ?? "").trim();

  if (to) {
    const draft = await draftAskMail(rawText);
    const fd = new FormData();
    fd.set("to", to);
    fd.set("subject", draft.subject);
    fd.set("body", draft.body);
    fd.set("individual", "on");
    fd.set("summary", draft.subject);
    fd.set("tasksJson", JSON.stringify([{ title: draft.subject, expectedResult: null }]));
    fd.set("rawOriginal", rawText); // 장부엔 사장이 실제 말한 문장이 남는다
    await composeAndSend(fd); // 발송 → 지시 생성 → 답장 대기 (redirects)
    return;
  }

  const summary = (rawText.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? rawText).slice(0, 100);
  const fd = new FormData();
  fd.set("rawText", rawText);
  fd.set("to", "");
  fd.set("summary", summary);
  fd.set("tasksJson", JSON.stringify([{ title: summary, expectedResult: null }]));
  await finalizeCapture(fd); // redirects
}

/**
 * 지시 삭제 — 작성자 본인 또는 관리자만. 오기입·테스트 지시 정리용이며,
 * 끝난 일은 삭제가 아니라 완료 처리가 정도(장부는 증빙이다).
 * 꼭지·댓글·직답 파일은 스키마 cascade가 지우고, 직답 토큰은 즉시 무효가 된다.
 */
export async function deleteInstruction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const inst = await prisma.instruction.findFirst({
    where: { id: instructionId, tenantId: tenant.id },
    select: { id: true, authorId: true, summary: true, rawText: true },
  });
  if (!inst) redirect("/instructions");
  if (inst.authorId !== user.id && !atLeast(user.role, "ADMIN")) redirect(`/instructions/${inst.id}`);

  await prisma.$transaction(async (tx) => {
    // 감사 기록을 먼저 — 무엇이 지워졌는지는 남는다
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId: user.id,
        action: "INSTRUCTION_DELETED",
        target: `${inst.id} · ${(inst.summary ?? inst.rawText).slice(0, 120)}`,
      },
    });
    await tx.instruction.delete({ where: { id: inst.id } });
  });

  revalidatePath("/instructions");
  revalidatePath("/dashboard");
  redirect("/instructions");
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

/**
 * One-click close for an email instruction: the author, seeing a reply arrived,
 * marks the active milestone DONE. The counterparty is an account-free email
 * recipient (can't submit through the review gate), so the asker closes their
 * own open loop — the mirror principle applied to email.
 */
export async function completeFromReply(formData: FormData) {
  const { tenant, user } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const inst = await prisma.instruction.findFirst({
    where: { id: instructionId, tenantId: tenant.id },
    select: { id: true, authorId: true },
  });
  if (!inst) return;
  if (inst.authorId !== user.id && !atLeast(user.role, "ADMIN")) return;

  const m = await prisma.milestone.findFirst({
    where: { tenantId: tenant.id, instructionId, status: { in: ["ACTIVE", "BLOCKED"] } },
    orderBy: { order: "asc" },
  });
  if (!m) return; // nothing open to close

  // the ledger's closing entry: WHAT actually came back, in the asker's words.
  // The say-do record holds both sides — the ask (rawText) and the outcome.
  const outcome = String(formData.get("outcome") ?? "").trim();

  await prisma.$transaction(async (tx) => {
    // 답이 전화·카톡·대면으로 왔어도 "답을 받았다"는 사실은 참이다 — 수동
    // 마감이 답장 대기 배지를 함께 꺼야 장부가 진실해진다.
    await tx.instruction.updateMany({
      where: { id: instructionId, replyReceivedAt: null, counterparty: { not: null } },
      data: { replyReceivedAt: new Date() },
    });
    await tx.milestone.update({
      where: { id: m.id },
      data: { status: "DONE", doneAt: new Date(), returnNote: null },
    });
    if (outcome) {
      await tx.milestoneComment.create({
        data: {
          tenantId: tenant.id,
          instructionId,
          milestoneId: m.id,
          authorId: user.id,
          body: `✅ 완료 기록: ${outcome.slice(0, 2000)}`,
          mentions: [] as Prisma.InputJsonValue,
        },
      });
    }
    await activateNext(tx, tenant.id, m);
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "MILESTONE_DONE_FROM_REPLY", target: m.id },
    });
  });

  revalidatePath(`/instructions/${instructionId}`);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
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
