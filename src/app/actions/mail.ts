"use server";

// In-app mail screen actions (pull model — everything runs on user action).
// SAY: the user picks a sent mail and registers it as a 지시; the recipients
// become the account-free counterparty whose reply is the DO.
// DO: "답장 확인" scans the inbox ONCE and stamps replies onto tracked threads.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { loadMailConn } from "@/lib/mail-conn";
import { testConnection, listRecentInbox, fetchBody, appendToSent, classifyConnError, connErrorDetail, protocolFor } from "@/lib/mail-fetch";
import { pop3Test } from "@/lib/pop3";
import { smtpSend, buildMessage, deriveSmtp } from "@/lib/smtp";
import { askMailText, askMailHtml } from "@/lib/mail-template";
import { refreshAccessToken, gmailSendRaw } from "@/lib/gmail";
import { detectEndpoints } from "@/lib/mail-autodetect";
import { randomUUID } from "node:crypto";
import { counterpartyOf, extractThreadRefs, normalizeMessageId, stripQuotedTail, pickInstructionForReply, normalizeEmail } from "@/lib/inbound-email";
import { generateMilestones } from "@/lib/ai";
import { notify, notifyEmail } from "@/lib/notify";
import type { Prisma } from "@prisma/client";

export async function saveMailConnection(formData: FormData) {
  const { tenant, user } = await requireContext();
  let host = String(formData.get("host") ?? "").trim();
  let port = Number(formData.get("port") ?? 0) || 0;
  const email = String(formData.get("email") ?? "").trim();
  // 사내 서버: 로그인 아이디가 메일 주소와 다를 수 있음 (빈 값 = 주소로 로그인)
  const loginUser = String(formData.get("loginUser") ?? "").trim() || null;
  let smtpHost = String(formData.get("smtpHost") ?? "").trim() || null;
  const smtpPortRaw = Number(formData.get("smtpPort") ?? 0);
  let smtpPort = smtpPortRaw > 0 ? smtpPortRaw : null;
  const pass = String(formData.get("password") ?? "");
  if (!email || !pass) redirect("/mail?error=missing");

  // 자동 감지: 서버를 안 적었으면 주소만으로 찾는다 (known provider / MX + 포트 스캔)
  if (!host) {
    const detected = await detectEndpoints(email);
    if (!detected.incoming) redirect("/mail?error=detect");
    host = detected.incoming.host;
    port = detected.incoming.port;
    if (!smtpHost && detected.smtp) {
      smtpHost = detected.smtp.host;
      smtpPort = detected.smtp.port;
    }
  }
  if (!port) port = 993;

  // verify before saving — a wrong app password should fail HERE, not on every open
  let failure: string | null = null;
  try {
    await testConnection({ host, port, email, login: loginUser, pass });
  } catch (e) {
    failure = classifyConnError(e);
  }
  if (failure) {
    // echo the entered values back (NOT the password) so a failed attempt
    // doesn't force the user to retype everything
    const echo = new URLSearchParams({
      error: "connect", why: failure, host, port: String(port), email, login: loginUser ?? "",
    });
    redirect(`/mail?${echo.toString()}`);
  }

  await prisma.mailConnection.upsert({
    where: { userId: user.id },
    create: { tenantId: tenant.id, userId: user.id, host, port, email, loginUser, smtpHost, smtpPort, encPass: encryptSecret(pass) },
    update: { host, port, email, loginUser, smtpHost, smtpPort, encPass: encryptSecret(pass) },
  });
  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorId: user.id, action: "MAIL_CONNECTED", target: email },
  });
  redirect("/mail");
}

/** Update ONLY the SMTP endpoint — no password re-entry, no reconnect. */
export async function updateSmtpSettings(formData: FormData) {
  const { user } = await requireContext();
  const smtpHost = String(formData.get("smtpHost") ?? "").trim() || null;
  const smtpPortRaw = Number(formData.get("smtpPort") ?? 0);
  const smtpPort = smtpPortRaw > 0 ? smtpPortRaw : null;
  const smtpAllowSelfSigned = formData.get("allowSelfSigned") === "on";
  await prisma.mailConnection.updateMany({
    where: { userId: user.id },
    data: { smtpHost, smtpPort, smtpAllowSelfSigned },
  });
  redirect("/mail?smtp=saved");
}

export async function deleteMailConnection() {
  const { tenant, user } = await requireContext();
  await prisma.mailConnection.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorId: user.id, action: "MAIL_DISCONNECTED", target: user.email },
  });
  redirect("/mail");
}

/**
 * Register one sent mail (picked in the list) as a 지시(SAY).
 * Metadata-only by default; `withBody` opts THIS mail into body storage +
 * AI milestone decomposition (per-mail consent, DECISIONS.md).
 */
export async function registerMailAsSay(formData: FormData) {
  const { tenant, user } = await requireContext();
  const messageId = normalizeMessageId(String(formData.get("messageId") ?? ""));
  const subject = String(formData.get("subject") ?? "").trim() || "(제목 없음)";
  const toRaw = String(formData.get("to") ?? "");
  const mailbox = String(formData.get("mailbox") ?? "");
  const seq = Number(formData.get("seq") ?? 0);
  const uid = String(formData.get("uid") ?? "") || undefined;
  const withBody = formData.get("withBody") === "1";
  if (!messageId) redirect("/mail?error=nomsgid");

  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const conn = await loadMailConn(user.id);
  // self-exclusion must use the MAILBOX address (json@icams.co.kr), which can
  // differ from the FlowDesk account email — otherwise "나"가 상대방으로 잡힘
  const selfEmail = conn?.email ?? user.email;

  // 여러 명에게 보낸 메일은 상대방마다 자기 루프를 가진다 (같은 스레드 공유)
  const counterparties = (counterpartyOf(to, selfEmail) || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const perRecipient: (string | null)[] = counterparties.length > 0 ? counterparties : [null];

  // idempotent per (thread, counterparty): re-click adds only the missing loops
  const existing = await prisma.instruction.findMany({
    where: { tenantId: tenant.id, threadMessageId: messageId },
    select: { id: true, counterparty: true },
  });
  const already = new Set(existing.map((r) => r.counterparty ?? ""));
  const missing = perRecipient.filter((c) => !already.has(c ?? ""));
  if (missing.length === 0 && existing.length > 0) redirect(`/instructions/${existing[0].id}`);

  let body = "";
  if (withBody && conn && (uid || (mailbox && seq > 0))) {
    body = stripQuotedTail(await fetchBody(conn, mailbox, seq, uid).catch(() => ""));
  }

  let summary = subject;
  let milestones: { title: string; expectedResult: string | null }[];
  if (body) {
    const gen = await generateMilestones(`${subject}\n\n${body}`);
    summary = gen.summary || summary;
    milestones = gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null }));
  } else {
    milestones = [{ title: subject, expectedResult: null }];
  }

  // one loop per counterparty — a reply from A must not close B's loop
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
        data: { tenantId: tenant.id, actorId: user.id, action: "INSTRUCTION_FROM_MAIL_APP", target: created.id },
      });
      return created;
    });
    createdIds.push(inst.id);
  }

  if (createdIds.length === 1) redirect(`/instructions/${createdIds[0]}`);
  redirect(`/dashboard?sent=${createdIds.length}`);
}

/**
 * Option B — compose INSIDE FlowDesk, send through the user's own SMTP
 * server, and register the SAY at the moment of saying. The recipient gets a
 * completely normal mail from the user's real address; FlowDesk minted the
 * Message-ID, so the reply matches back with no BCC habit required.
 * POP3 servers: we auto-BCC the user so a copy exists in their mailbox.
 * IMAP servers: we APPEND a copy to the real sent folder (best-effort).
 */
export async function composeAndSend(formData: FormData) {
  const { tenant, user } = await requireContext();
  const conn = await loadMailConn(user.id);
  if (!conn) redirect("/mail?error=noconn");

  const to = String(formData.get("to") ?? "")
    .split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const subject = String(formData.get("subject") ?? "").trim();
  const text = String(formData.get("body") ?? "").trim();
  // 여러 명에게 맡기면 각자 자기 몫의 답을 빚진다 — 기본은 수신자별 개별
  // 발송·개별 루프. 끄면 공동 스레드 하나로 추적(아무나 답하면 됨).
  const individual = formData.get("individual") === "on" && to.length > 1;
  if (to.length === 0 || !subject) redirect("/mail?error=compose_missing");

  const isGmailConn = conn.provider === "gmail" && !!conn.refresh;
  const isPop3 = !isGmailConn && protocolFor(conn.port) === "pop3";
  const smtp = {
    host: conn.smtpHost ?? deriveSmtp(conn.host).host,
    port: conn.smtpPort ?? deriveSmtp(conn.host).port,
    user: conn.login?.trim() || conn.email,
    pass: conn.pass,
    allowSelfSigned: conn.smtpAllowSelfSigned,
    // servers disagree on bare id vs full address for SMTP AUTH — retry all forms
    authAlternates: [conn.email, conn.email.split("@")[0]],
  };
  const domain = conn.email.split("@")[1] ?? "flowdesk.local";

  // POP-before-SMTP: 옛 국산 서버(Nmail 등)는 POP3 로그인으로 발신 자격을
  // 부여한다 — 보내기 직전에 한 번 로그인해 두면 어느 쪽이든 무해하다
  if (isPop3) {
    await pop3Test({ host: conn.host, port: conn.port, user: smtp.user, pass: conn.pass }).catch(() => {});
  }

  // decompose ONCE — the same body applies to every recipient's loop
  let summary = subject;
  let milestones: { title: string; expectedResult: string | null }[];
  if (text) {
    const gen = await generateMilestones(`${subject}\n\n${text}`);
    summary = gen.summary || summary;
    milestones = gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null }));
  } else {
    milestones = [{ title: subject, expectedResult: null }];
  }

  const createInstruction = (messageId: string, counterparty: string | null, replyToken: string) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.instruction.create({
        data: {
          tenantId: tenant.id,
          authorId: user.id,
          rawText: text ? `${subject}\n\n${text}` : subject,
          summary,
          source: "EMAIL",
          threadMessageId: messageId,
          counterparty,
          replyToken,
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
        data: { tenantId: tenant.id, actorId: user.id, action: "INSTRUCTION_FROM_COMPOSE", target: created.id },
      });
      return created;
    });

  // 개별 모드: 수신자마다 자기 Message-ID를 가진 별도 메일 → 답장이 정확히
  // 자기 루프에 꽂힌다 (수신자끼리 서로 안 보이는 건 덤 — 견적 요청 예절)
  const batches: { rcpts: string[]; counterparty: string | null }[] = individual
    ? to.map((r) => ({ rcpts: [r], counterparty: counterpartyOf([r], conn.email) || null }))
    : [{ rcpts: to, counterparty: counterpartyOf(to, conn.email) || null }];

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const createdIds: string[] = [];
  for (const [i, batch] of batches.entries()) {
    let messageId = `fd-${randomUUID()}@${domain}`;
    // 직답 버튼: unguessable token → account-free answer page → straight into DB
    const replyToken = randomUUID();
    const ask = {
      senderName: user.name,
      senderEmail: conn.email,
      subject,
      body: text,
      replyUrl: `${appUrl}/r/${replyToken}`,
    };
    const mail = {
      from: conn.email,
      to: batch.rcpts,
      bcc: isPop3 ? [conn.email] : [], // POP3: keep a copy where we can see it
      subject,
      text: askMailText(ask),
      html: askMailHtml(ask),
      messageId,
    };
    try {
      if (isGmailConn) {
        // Gmail may rewrite the Message-ID — track what it actually stored,
        // because the counterparty's reply will reference THAT id
        const accessToken = await refreshAccessToken(conn.refresh!);
        messageId = await gmailSendRaw(accessToken, buildMessage(mail));
      } else {
        await smtpSend(smtp, mail);
      }
    } catch (e) {
      const why = classifyConnError(e);
      // partial failure: report what went out and what didn't, keep the draft
      const remaining = batches.slice(i).flatMap((b) => b.rcpts).join(", ");
      const echo = new URLSearchParams({
        error: "send", why, detail: connErrorDetail(e), to: remaining, subject, body: text,
        ...(createdIds.length ? { sent: String(createdIds.length) } : {}),
      });
      redirect(`/mail?${echo.toString()}`);
    }
    if (!isPop3 && !isGmailConn) void appendToSent(conn, buildMessage(mail)).catch(() => {});
    const inst = await createInstruction(messageId, batch.counterparty, replyToken);
    createdIds.push(inst.id);
  }

  if (createdIds.length === 1) redirect(`/instructions/${createdIds[0]}`);
  redirect(`/dashboard?sent=${createdIds.length}`);
}

/**
 * Scan the inbox once (right now, because the user asked) and stamp replies
 * onto tracked email threads. Mirror principle: surfaces the reply, never
 * auto-completes — the asker closes the loop on the dashboard.
 */
export async function syncReplies() {
  const { tenant, user } = await requireContext();
  const conn = await loadMailConn(user.id);
  if (!conn) redirect("/mail?error=noconn");

  const inbox = await listRecentInbox(conn, 30).catch(() => []);
  const candidates = inbox.filter((m) => m.inReplyTo || m.references);

  let matched = 0;
  for (const m of candidates) {
    const refs = extractThreadRefs({ inReplyTo: m.inReplyTo, references: m.references });
    if (refs.length === 0) continue;
    // several loops can share one thread (multi-recipient SAY) — the reply
    // belongs to the SENDER's loop, not whichever row happens to come first
    const candidatesRows = await prisma.instruction.findMany({
      where: { tenantId: tenant.id, threadMessageId: { in: refs }, source: "EMAIL" },
      select: { id: true, authorId: true, summary: true, replyReceivedAt: true, counterparty: true },
    });
    const senderEmail = m.from ?? "(알 수 없음)";
    const parent = pickInstructionForReply(candidatesRows, senderEmail);
    if (!parent) continue;
    if (!parent.replyReceivedAt) {
      await prisma.instruction.update({
        where: { id: parent.id },
        data: { replyReceivedAt: m.date ? new Date(m.date) : new Date() },
      });
      await prisma.milestoneComment.create({
        data: {
          tenantId: tenant.id,
          instructionId: parent.id,
          milestoneId: null,
          authorId: parent.authorId,
          body: `📧 답장 도착: ${senderEmail} · "${m.subject ?? ""}"`,
          mentions: [] as Prisma.InputJsonValue,
        },
      });
      const entry = {
        tenantId: tenant.id, userId: parent.authorId, type: "PROOF_ADDED",
        title: `📧 답장 도착: ${parent.summary ?? m.subject ?? ""}`,
        body: `${senderEmail} 님이 회신했습니다.`,
        link: `/instructions/${parent.id}`,
      };
      await notify(prisma, entry);
      void notifyEmail(entry).catch(() => {});
      matched++;
    }
  }

  await prisma.mailConnection.updateMany({ where: { userId: user.id }, data: { lastSyncAt: new Date() } });
  revalidatePath("/mail");
  revalidatePath("/dashboard");
  redirect(`/mail?synced=${matched}`);
}
