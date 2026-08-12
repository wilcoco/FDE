// Server-side IMAP fetch for the in-app mail screen. Pull model only: these
// run when the user opens /mail or presses a button — there is no background
// job. Nothing is stored unless the user registers a specific mail.

import { ImapFlow } from "imapflow";
import { pickSentMailbox, type MailEnvelope } from "./connector";
import { pop3Test, pop3ListRecent, pop3FetchRaw } from "./pop3";
import { headersToEnvelope, extractTextBody } from "./mail-headers";
import { refreshAccessToken } from "./gmail";

export interface ImapConn {
  host: string;
  port: number;
  email: string;
  /** IMAP login id when it differs from the address (사내 서버: "json"). */
  login?: string | null;
  pass: string;
  /** "gmail" switches all fetch paths to the Gmail API (OAuth). */
  provider?: string;
  /** decrypted OAuth refresh token (gmail only) */
  refresh?: string | null;
}

function isGmail(conn: ImapConn): boolean {
  return conn.provider === "gmail" && !!conn.refresh;
}

export interface ListedMail extends MailEnvelope {
  seq: number;
  mailbox: string;
  /** POP3 UIDL — stable across sessions (POP3 seq numbers are not). */
  uid?: string;
}

/**
 * Protocol by port: 995/110 = POP3 (Nmail 등 국산 POP3-전용 서버),
 * everything else = IMAP. Keeps the setup form to a single "포트" field.
 */
export function protocolFor(port: number): "imap" | "pop3" {
  return port === 995 || port === 110 ? "pop3" : "imap";
}

/** 993 = implicit TLS (IMAPS); anything else (143 등) = plaintext + STARTTLS upgrade. */
export function imapSecure(port: number): boolean {
  return port === 993;
}

function client(conn: ImapConn): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: imapSecure(conn.port),
    auth: { user: conn.login?.trim() || conn.email, pass: conn.pass },
    logger: false,
    // a hung mail server must not hang the page render — and a firewall that
    // silently DROPS packets must not leave the user staring at nothing for
    // the 90s default connect timeout
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

/** Why a connection attempt failed, in terms the user can act on. */
export type ConnFailure = "auth" | "timeout" | "refused" | "dns" | "cert" | "other";

const CERT_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

export function classifyConnError(e: unknown): ConnFailure {
  const err = e as { code?: string; authenticationFailed?: boolean; message?: string };
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|LOGIN failed|Invalid credentials/i.test(err?.message ?? "")) return "auth";
  if (err?.code && CERT_CODES.has(err.code)) return "cert"; // 사내 서버 자체서명 인증서
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return "dns";
  if (err?.code === "ECONNREFUSED") return "refused";
  if (err?.code === "ETIMEDOUT" || err?.code === "CONNECT_TIMEOUT" || /timeout|required time/i.test(err?.message ?? "")) return "timeout";
  return "other";
}

/** Short, safe error line for showing the user WHAT actually failed. */
export function connErrorDetail(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? "").replace(/[\r\n]+/g, " ").slice(0, 120);
  return [err?.code, msg].filter(Boolean).join(" — ");
}

function pop3ConnOf(conn: ImapConn) {
  return { host: conn.host, port: conn.port, user: conn.login?.trim() || conn.email, pass: conn.pass };
}

/** Verify credentials by connecting and logging out. Throws on failure. */
export async function testConnection(conn: ImapConn): Promise<void> {
  if (isGmail(conn)) { await refreshAccessToken(conn.refresh!); return; }
  if (protocolFor(conn.port) === "pop3") return pop3Test(pop3ConnOf(conn));
  const c = client(conn);
  await c.connect();
  await c.logout();
}

async function fetchRecent(c: ImapFlow, mailbox: string, n: number): Promise<ListedMail[]> {
  const lock = await c.getMailboxLock(mailbox);
  try {
    const status = await c.status(mailbox, { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) return [];
    const from = Math.max(1, total - n + 1);
    const out: ListedMail[] = [];
    for await (const msg of c.fetch(`${from}:${total}`, { envelope: true, headers: ["references", "in-reply-to"] })) {
      const h = msg.headers?.toString() ?? "";
      const ref = /references:\s*([^\r\n]+)/i.exec(h)?.[1] ?? null;
      const irt = /in-reply-to:\s*([^\r\n]+)/i.exec(h)?.[1] ?? null;
      out.push({
        seq: msg.seq,
        mailbox,
        messageId: msg.envelope?.messageId?.replace(/^<|>$/g, "") ?? `local-${mailbox}-${msg.seq}`,
        inReplyTo: irt ?? msg.envelope?.inReplyTo ?? null,
        references: ref,
        subject: msg.envelope?.subject ?? null,
        from: msg.envelope?.from?.map((a) => `${a.name ?? ""} <${a.address}>`).join(", ") ?? null,
        to: msg.envelope?.to?.map((a) => a.address ?? "") ?? [],
        date: msg.envelope?.date?.toISOString() ?? null,
      });
    }
    return out.reverse(); // newest first
  } finally {
    lock.release();
  }
}

/** POP3: recent inbox headers → ListedMail (metadata-only at protocol level). */
async function pop3Recent(conn: ImapConn, n: number): Promise<ListedMail[]> {
  const mails = await pop3ListRecent(pop3ConnOf(conn), n);
  return mails.map((m) => ({
    ...headersToEnvelope(m.rawHeaders, `pop3-${m.uid}`),
    seq: m.seq,
    uid: m.uid,
    mailbox: "INBOX",
  }));
}

/**
 * Recent sent mail (my SAYs waiting out there) — metadata only.
 * POP3 has no sent folder; the inbox stands in (self-BCC workflow) and the
 * page explains the habit.
 */
export async function listRecentSent(conn: ImapConn, n = 20): Promise<ListedMail[]> {
  // Gmail is send-only (gmail.send, sensitive scope): listing the mailbox
  // would need a RESTRICTED scope (CASA audit). SAYs are born in the app and
  // replies arrive via the 직답 button — there is nothing to list.
  if (isGmail(conn)) return [];
  if (protocolFor(conn.port) === "pop3") return pop3Recent(conn, n);
  const c = client(conn);
  await c.connect();
  try {
    const boxes = await c.list();
    const sent = pickSentMailbox(boxes.map((b) => ({ path: b.path, specialUse: b.specialUse })));
    if (!sent) throw new Error("보낸편지함을 찾지 못했습니다");
    return await fetchRecent(c, sent, n);
  } finally {
    await c.logout().catch(() => {});
  }
}

/** Recent inbox mail — used to detect replies to tracked threads. */
export async function listRecentInbox(conn: ImapConn, n = 30): Promise<ListedMail[]> {
  if (isGmail(conn)) return []; // send-only scope — replies come via 직답, not inbox polling
  if (protocolFor(conn.port) === "pop3") return pop3Recent(conn, n);
  const c = client(conn);
  await c.connect();
  try {
    return await fetchRecent(c, "INBOX", n);
  } finally {
    await c.logout().catch(() => {});
  }
}

/**
 * IMAP only: store a copy of a sent message into the real sent folder, so the
 * user's webmail 보낸편지함 stays truthful about mail composed in FlowDesk.
 * Best-effort — a failure here must never fail the send itself.
 */
export async function appendToSent(conn: ImapConn, rawMessage: string): Promise<void> {
  if (isGmail(conn)) return; // Gmail API stores sent mail itself
  if (protocolFor(conn.port) === "pop3") return; // no folders in POP3
  const c = client(conn);
  await c.connect();
  try {
    const boxes = await c.list();
    const sent = pickSentMailbox(boxes.map((b) => ({ path: b.path, specialUse: b.specialUse })));
    if (!sent) return;
    await c.append(sent, rawMessage, ["\\Seen"]);
  } finally {
    await c.logout().catch(() => {});
  }
}

/** Body of one specific mail — fetched ONLY on per-mail opt-in. */
export async function fetchBody(conn: ImapConn, mailbox: string, seq: number, uid?: string): Promise<string> {
  // Gmail is send-only — we structurally cannot fetch anything from the mailbox
  if (isGmail(conn)) return "";
  if (protocolFor(conn.port) === "pop3") {
    if (!uid) return "";
    const raw = await pop3FetchRaw(pop3ConnOf(conn), uid);
    return raw ? extractTextBody(raw) : "";
  }
  const c = client(conn);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg = await c.fetchOne(String(seq), { bodyParts: ["text"] });
      const part = msg && typeof msg === "object" ? msg.bodyParts?.get("text") : null;
      return part ? part.toString("utf8") : "";
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}
