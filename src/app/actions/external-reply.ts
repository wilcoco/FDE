"use server";

// 직답 버튼의 수신측: 계정 없는 상대방이 /r/{token} 페이지에서 쓴 답변을
// 그 지시의 루프에 직접 꽂는다. 인증은 토큰 소지 그 자체 (unguessable UUID,
// 메일을 받은 사람만 안다) — CC 웹훅과 같은 권한 모델이다.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { notify, notifyEmail } from "@/lib/notify";
import { loadMailConn } from "@/lib/mail-conn";
import { smtpSend, buildMessage, deriveSmtp } from "@/lib/smtp";
import { refreshAccessToken, gmailSendRaw } from "@/lib/gmail";
import { protocolFor } from "@/lib/mail-fetch";
import { pop3Test } from "@/lib/pop3";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export async function submitExternalReply(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim().slice(0, 5000);
  const responder = String(formData.get("responder") ?? "").trim().slice(0, 100);
  if (!token) redirect("/");
  if (!content) redirect(`/r/${token}?error=empty`);

  const inst = await prisma.instruction.findUnique({
    where: { replyToken: token },
    select: { id: true, tenantId: true, authorId: true, summary: true, counterparty: true, replyReceivedAt: true, threadMessageId: true },
  });
  if (!inst) redirect("/r/invalid");

  const who = responder || inst.counterparty || "상대방";

  await prisma.$transaction(async (tx) => {
    if (!inst.replyReceivedAt) {
      await tx.instruction.update({
        where: { id: inst.id },
        data: { replyReceivedAt: new Date() },
      });
    }
    await tx.milestoneComment.create({
      data: {
        tenantId: inst.tenantId,
        instructionId: inst.id,
        milestoneId: null,
        authorId: inst.authorId, // thread attribution (the counterparty has no account)
        body: `📧 답변 도착(웹) — ${who}:\n${content}`,
        mentions: [] as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: { tenantId: inst.tenantId, actorId: inst.authorId, action: "EXTERNAL_REPLY_WEB", target: inst.id },
    });
  });

  const entry = {
    tenantId: inst.tenantId,
    userId: inst.authorId,
    type: "PROOF_ADDED",
    title: `📧 답변 도착: ${inst.summary ?? ""}`,
    body: `${who} 님이 웹에서 바로 답변했습니다.`,
    link: `/instructions/${inst.id}`,
  };
  await notify(prisma, entry);
  void notifyEmail(entry).catch(() => {});

  // 메일 스레드도 온전하게: 답변 사본을 지시자 본인의 메일함에 원래 스레드의
  // 회신(In-Reply-To)으로 밀어넣는다. 실패해도 답변 전달 자체는 성공이다.
  void forwardIntoThread(inst, who, content).catch(() => {});

  redirect(`/r/${token}?done=1`);
}

async function forwardIntoThread(
  inst: { authorId: string; summary: string | null; threadMessageId: string | null },
  who: string,
  content: string,
): Promise<void> {
  const conn = await loadMailConn(inst.authorId);
  if (!conn) return;
  const domain = conn.email.split("@")[1] ?? "saydog.local";
  const mail = {
    from: conn.email,
    to: [conn.email], // 내 편지함에 스레드 회신으로 꽂힌다
    subject: `Re: ${inst.summary ?? "요청"}`,
    text: `[Saydog 직답] ${who} 님의 답변:\n\n${content}`,
    inReplyTo: inst.threadMessageId ?? undefined,
    messageId: `fd-web-${randomUUID()}@${domain}`,
  };
  if (conn.provider === "gmail" && conn.refresh) {
    const accessToken = await refreshAccessToken(conn.refresh);
    await gmailSendRaw(accessToken, buildMessage(mail));
    return;
  }
  const smtp = {
    host: conn.smtpHost ?? deriveSmtp(conn.host).host,
    port: conn.smtpPort ?? deriveSmtp(conn.host).port,
    user: conn.login?.trim() || conn.email,
    pass: conn.pass,
    allowSelfSigned: conn.smtpAllowSelfSigned,
    authAlternates: [conn.email, conn.email.split("@")[0]],
  };
  if (protocolFor(conn.port) === "pop3") {
    await pop3Test({ host: conn.host, port: conn.port, user: smtp.user, pass: conn.pass }).catch(() => {});
  }
  await smtpSend(smtp, mail);
}
