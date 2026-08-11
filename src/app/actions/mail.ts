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
import { testConnection, listRecentInbox, fetchBody, appendToSent, classifyConnError, protocolFor } from "@/lib/mail-fetch";
import { smtpSend, buildMessage, deriveSmtp } from "@/lib/smtp";
import { randomUUID } from "node:crypto";
import { counterpartyOf, extractThreadRefs, normalizeMessageId, stripQuotedTail } from "@/lib/inbound-email";
import { generateMilestones } from "@/lib/ai";
import { notify, notifyEmail } from "@/lib/notify";
import type { Prisma } from "@prisma/client";

export async function saveMailConnection(formData: FormData) {
  const { tenant, user } = await requireContext();
  const host = String(formData.get("host") ?? "").trim();
  const port = Number(formData.get("port") ?? 993) || 993;
  const email = String(formData.get("email") ?? "").trim();
  // 사내 서버: 로그인 아이디가 메일 주소와 다를 수 있음 (빈 값 = 주소로 로그인)
  const loginUser = String(formData.get("loginUser") ?? "").trim() || null;
  const smtpHost = String(formData.get("smtpHost") ?? "").trim() || null;
  const smtpPortRaw = Number(formData.get("smtpPort") ?? 0);
  const smtpPort = smtpPortRaw > 0 ? smtpPortRaw : null;
  const pass = String(formData.get("password") ?? "");
  if (!host || !email || !pass) redirect("/mail?error=missing");

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
  await prisma.mailConnection.updateMany({
    where: { userId: user.id },
    data: { smtpHost, smtpPort },
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

  // idempotent: registering the same mail twice is a no-op
  const dup = await prisma.instruction.findFirst({
    where: { tenantId: tenant.id, threadMessageId: messageId },
    select: { id: true },
  });
  if (dup) redirect(`/instructions/${dup.id}`);

  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const conn = await loadMailConn(user.id);
  // self-exclusion must use the MAILBOX address (json@icams.co.kr), which can
  // differ from the FlowDesk account email — otherwise "나"가 상대방으로 잡힘
  const selfEmail = conn?.email ?? user.email;

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

  const inst = await prisma.$transaction(async (tx) => {
    const created = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText: body ? `${subject}\n\n${body}` : `[메타데이터만] ${subject}`,
        summary,
        source: "EMAIL",
        threadMessageId: messageId,
        counterparty: counterpartyOf(to, selfEmail) || null,
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

  redirect(`/instructions/${inst.id}`);
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
  if (to.length === 0 || !subject) redirect("/mail?error=compose_missing");

  const isPop3 = protocolFor(conn.port) === "pop3";
  const smtp = {
    host: conn.smtpHost ?? deriveSmtp(conn.host).host,
    port: conn.smtpPort ?? deriveSmtp(conn.host).port,
    user: conn.login?.trim() || conn.email,
    pass: conn.pass,
  };
  const domain = conn.email.split("@")[1] ?? "flowdesk.local";
  const messageId = `fd-${randomUUID()}@${domain}`;
  const mail = {
    from: conn.email,
    to,
    bcc: isPop3 ? [conn.email] : [], // POP3: keep a copy where we can see it
    subject,
    text,
    messageId,
  };

  try {
    await smtpSend(smtp, mail);
  } catch (e) {
    const why = classifyConnError(e);
    const echo = new URLSearchParams({ error: "send", why, to: to.join(", "), subject, body: text });
    redirect(`/mail?${echo.toString()}`);
  }

  // IMAP: keep the webmail 보낸편지함 truthful (never fail the send over this)
  if (!isPop3) void appendToSent(conn, buildMessage(mail)).catch(() => {});

  // the SAY is born tracked — same shape as a registered mail
  let summary = subject;
  let milestones: { title: string; expectedResult: string | null }[];
  if (text) {
    const gen = await generateMilestones(`${subject}\n\n${text}`);
    summary = gen.summary || summary;
    milestones = gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null }));
  } else {
    milestones = [{ title: subject, expectedResult: null }];
  }

  const inst = await prisma.$transaction(async (tx) => {
    const created = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText: text ? `${subject}\n\n${text}` : subject,
        summary,
        source: "EMAIL",
        threadMessageId: messageId,
        counterparty: counterpartyOf(to, conn.email) || null,
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

  redirect(`/instructions/${inst.id}`);
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
    const parent = await prisma.instruction.findFirst({
      where: { tenantId: tenant.id, threadMessageId: { in: refs }, source: "EMAIL" },
      select: { id: true, authorId: true, summary: true, replyReceivedAt: true },
    });
    if (!parent) continue;

    const senderEmail = m.from ?? "(알 수 없음)";
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
