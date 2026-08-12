// 직답 제출의 본체 — 라우트 핸들러(표준 multipart)에서 호출된다.
// 서버 액션은 파일을 빈 껍데기로 직렬화하는 한계가 있어 업로드는 이 경로만 쓴다.

import { prisma } from "./db";
import { notify, notifyEmail } from "./notify";
import { loadMailConn } from "./mail-conn";
import { smtpSend, buildMessage, deriveSmtp } from "./smtp";
import { refreshAccessToken, gmailSendRaw } from "./gmail";
import { protocolFor } from "./mail-fetch";
import { pop3Test } from "./pop3";
import { randomUUID } from "node:crypto";
import { replyTokenExpired } from "./reply-token";
import type { Prisma } from "@prisma/client";

export const MAX_FILES = 3;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface ReplyUpload { name: string; mime: string; buf: Buffer }

export type ReplyResult = "ok" | "empty" | "file" | "invalid" | "expired";

export async function processExternalReply(
  token: string,
  content: string,
  responder: string,
  files: ReplyUpload[],
): Promise<ReplyResult> {
  if (!content.trim()) return "empty";
  if (files.length > MAX_FILES || files.some((f) => f.buf.length > MAX_FILE_SIZE)) return "file";

  const inst = await prisma.instruction.findUnique({
    where: { replyToken: token },
    select: { id: true, tenantId: true, authorId: true, summary: true, counterparty: true, replyReceivedAt: true, threadMessageId: true, status: true, createdAt: true },
  });
  if (!inst) return "invalid";
  if (replyTokenExpired(inst)) return "expired"; // 유출된 링크가 영원히 살지 않게

  const body = content.trim().slice(0, 5000);
  const who = responder.trim().slice(0, 100) || inst.counterparty || "상대방";

  await prisma.$transaction(async (tx) => {
    if (!inst.replyReceivedAt) {
      await tx.instruction.update({ where: { id: inst.id }, data: { replyReceivedAt: new Date() } });
    }
    await tx.milestoneComment.create({
      data: {
        tenantId: inst.tenantId,
        instructionId: inst.id,
        milestoneId: null,
        authorId: inst.authorId, // thread attribution (the counterparty has no account)
        body: `📧 답변 도착(웹) — ${who}:\n${body}`,
        mentions: [] as Prisma.InputJsonValue,
      },
    });
    for (const f of files) {
      await tx.replyFile.create({
        data: {
          tenantId: inst.tenantId,
          instructionId: inst.id,
          name: f.name.slice(0, 200),
          mime: f.mime || "application/octet-stream",
          size: f.buf.length,
          data: new Uint8Array(f.buf), // Prisma Bytes wants a plain ArrayBuffer-backed view
        },
      });
    }
    if (files.length) {
      await tx.milestoneComment.create({
        data: {
          tenantId: inst.tenantId,
          instructionId: inst.id,
          milestoneId: null,
          authorId: inst.authorId,
          body: `📎 첨부 ${files.length}개: ${files.map((f) => f.name).join(", ")} (지시 페이지에서 다운로드)`,
          mentions: [] as Prisma.InputJsonValue,
        },
      });
    }
    await tx.auditLog.create({
      data: { tenantId: inst.tenantId, actorId: inst.authorId, action: "EXTERNAL_REPLY_WEB", target: inst.id },
    });
  });

  const entry = {
    tenantId: inst.tenantId,
    userId: inst.authorId,
    type: "PROOF_ADDED",
    title: `📧 답변 도착: ${inst.summary ?? ""}`,
    body: `${who} 님이 웹에서 바로 답변했습니다.${files.length ? ` (첨부 ${files.length}개)` : ""}`,
    link: `/instructions/${inst.id}`,
  };
  await notify(prisma, entry);
  void notifyEmail(entry).catch(() => {});

  // 메일 스레드도 온전하게: 답변+첨부를 지시자 메일함에 원 스레드의 회신으로.
  // 실패해도 답변 전달 자체는 성공이다.
  void forwardIntoThread(inst, who, body, files).catch(() => {});
  return "ok";
}

async function forwardIntoThread(
  inst: { authorId: string; summary: string | null; threadMessageId: string | null },
  who: string,
  content: string,
  files: ReplyUpload[],
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
    attachments: files.map((f) => ({ name: f.name, mime: f.mime, dataB64: f.buf.toString("base64") })),
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
