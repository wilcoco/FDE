// Server-side IMAP fetch for the in-app mail screen. Pull model only: these
// run when the user opens /mail or presses a button — there is no background
// job. Nothing is stored unless the user registers a specific mail.

import { ImapFlow } from "imapflow";
import { pickSentMailbox, type MailEnvelope } from "./connector";

export interface ImapConn {
  host: string;
  port: number;
  email: string;
  pass: string;
}

export interface ListedMail extends MailEnvelope {
  seq: number;
  mailbox: string;
}

function client(conn: ImapConn): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: true,
    auth: { user: conn.email, pass: conn.pass },
    logger: false,
    // a hung mail server must not hang the page render
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

/** Verify credentials by connecting and logging out. Throws on failure. */
export async function testConnection(conn: ImapConn): Promise<void> {
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

/** Recent sent mail (my SAYs waiting out there) — metadata only. */
export async function listRecentSent(conn: ImapConn, n = 20): Promise<ListedMail[]> {
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
  const c = client(conn);
  await c.connect();
  try {
    return await fetchRecent(c, "INBOX", n);
  } finally {
    await c.logout().catch(() => {});
  }
}

/** Body of one specific mail — fetched ONLY on per-mail opt-in. */
export async function fetchBody(conn: ImapConn, mailbox: string, seq: number): Promise<string> {
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
