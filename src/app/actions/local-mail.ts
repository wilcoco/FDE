"use server";

// 브라우저-로컬 Gmail 경로의 서버 수신부. 서버는 구글 토큰을 만진 적도,
// 메일함을 조회한 적도 없다 — 사용자가 브라우저에서 직접 골라 올린
// 결과(say-do 장부 항목)만 받는다. 원본 메일의 유일한 사본은 사용자의
// 메일함에 그대로 있다.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { loadMailConn } from "@/lib/mail-conn";
import { counterpartyOf, normalizeMessageId, stripQuotedTail } from "@/lib/inbound-email";
import { generateMilestones } from "@/lib/ai";
import { notify, notifyEmail } from "@/lib/notify";
import type { Prisma } from "@prisma/client";

/** 브라우저가 읽어 사용자가 등록을 누른 보낸 메일 → SAY (user-configured). */
export async function registerLocalMail(formData: FormData) {
  const { tenant, user } = await requireContext();
  const messageId = normalizeMessageId(String(formData.get("messageId") ?? ""));
  const subject = String(formData.get("subject") ?? "").trim() || "(제목 없음)";
  const toRaw = String(formData.get("to") ?? "");
  const body = stripQuotedTail(String(formData.get("body") ?? "")).slice(0, 20_000);
  if (!messageId) redirect("/mail?error=nomsgid");

  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const conn = await loadMailConn(user.id);
  const selfEmail = conn?.email ?? user.email;

  // 여러 명에게 보낸 메일은 상대방마다 자기 루프 (registerMailAsSay와 동일 규칙)
  const counterparties = (counterpartyOf(to, selfEmail) || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const perRecipient: (string | null)[] = counterparties.length > 0 ? counterparties : [null];

  const existing = await prisma.instruction.findMany({
    where: { tenantId: tenant.id, threadMessageId: messageId },
    select: { id: true, counterparty: true },
  });
  const already = new Set(existing.map((r) => r.counterparty ?? ""));
  const missing = perRecipient.filter((c) => !already.has(c ?? ""));
  if (missing.length === 0 && existing.length > 0) redirect(`/instructions/${existing[0].id}`);

  let summary = subject;
  let milestones: { title: string; expectedResult: string | null }[];
  if (body) {
    const gen = await generateMilestones(`${subject}\n\n${body}`);
    summary = gen.summary || summary;
    milestones = gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null }));
  } else {
    milestones = [{ title: subject, expectedResult: null }];
  }

  const createdIds: string[] = [];
  for (const counterparty of missing) {
    const inst = await prisma.$transaction(async (tx) => {
      const created = await tx.instruction.create({
        data: {
          tenantId: tenant.id,
          authorId: user.id,
          rawText: body ? `${subject}\n\n${body}` : `[메타데이터만] ${subject}`,
          summary,
          source: "EMAIL",
          threadMessageId: messageId,
          counterparty,
        },
      });
      await tx.milestone.createMany({
        data: milestones.map((m, i) => ({
          tenantId: tenant.id,
          instructionId: created.id,
          order: i,
          title: m.title,
          expectedResult: m.expectedResult,
          status: (i === 0 ? "ACTIVE" : "PENDING") as Prisma.MilestoneCreateManyInput["status"],
          activatedAt: i === 0 ? new Date() : null,
          proof: [] as Prisma.InputJsonValue,
        })),
      });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actorId: user.id, action: "INSTRUCTION_FROM_LOCAL_MAIL", target: created.id },
      });
      return created;
    });
    createdIds.push(inst.id);
  }

  revalidatePath("/mail");
  revalidatePath("/dashboard");
  redirect(createdIds.length === 1 ? `/instructions/${createdIds[0]}` : "/dashboard");
}

/** 브라우저가 감지한 답장 도착 — 사용자가 [기록]을 눌러 확정한 것만 올라온다. */
export async function markLocalReply(formData: FormData) {
  const { tenant, user } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const from = String(formData.get("from") ?? "").slice(0, 200) || "(알 수 없음)";
  const subject = String(formData.get("subject") ?? "").slice(0, 300);
  const dateRaw = String(formData.get("date") ?? "");

  const inst = await prisma.instruction.findFirst({
    where: { id: instructionId, tenantId: tenant.id, authorId: user.id },
    select: { id: true, summary: true, replyReceivedAt: true },
  });
  if (!inst) redirect("/mail?error=noconn");
  if (inst.replyReceivedAt) redirect(`/instructions/${inst.id}`); // 이미 기록됨 — 멱등

  const when = dateRaw ? new Date(dateRaw) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.instruction.update({
      where: { id: inst.id },
      data: { replyReceivedAt: isNaN(when.getTime()) ? new Date() : when },
    });
    await tx.milestoneComment.create({
      data: {
        tenantId: tenant.id,
        instructionId: inst.id,
        milestoneId: null,
        authorId: user.id,
        body: `📧 답장 도착(브라우저 감지): ${from} · "${subject}"`,
        mentions: [] as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "REPLY_FROM_LOCAL_MAIL", target: inst.id },
    });
  });

  const entry = {
    tenantId: tenant.id, userId: user.id, type: "PROOF_ADDED",
    title: `📧 답장 도착: ${inst.summary ?? subject}`,
    body: `${from} 님이 회신했습니다.`,
    link: `/instructions/${inst.id}`,
  };
  await notify(prisma, entry);
  void notifyEmail(entry).catch(() => {});

  revalidatePath("/mail");
  revalidatePath("/dashboard");
  redirect(`/mail?synced=1`);
}
