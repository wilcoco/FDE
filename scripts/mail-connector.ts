/**
 * Local mail connector (heart of the future desktop app) — reads YOUR mailbox
 * on YOUR machine via IMAP and registers selected mails as 지시(SAY) through
 * the same intake pipeline as the CC flow. Credentials never leave this
 * machine; by default only metadata (subject/sender/thread) is sent.
 *
 * Usage:
 *   IMAP_HOST=imap.naver.com IMAP_USER=me@naver.com IMAP_PASS=<앱비밀번호> \
 *   FLOWDESK_URL=https://app... INBOUND_ADDRESS=acme-x7k2ab@in.flowdesk.app \
 *   npx tsx scripts/mail-connector.ts --list           # 최근 보낸메일 20건
 *   npx tsx scripts/mail-connector.ts --register 3     # 3번을 지시로 등록(메타데이터만)
 *   npx tsx scripts/mail-connector.ts --register 3 --with-body  # 본문 포함(그 메일만 옵트인)
 *   npx tsx scripts/mail-connector.ts --sync-replies   # 받은편지함에서 답장 감지→DO
 */
import { ImapFlow } from "imapflow";
import { envelopeToIntakePayload, pickSentMailbox, formatMailRow, type MailEnvelope } from "../src/lib/connector";

const HOST = process.env.IMAP_HOST!;
const USER = process.env.IMAP_USER!;
const PASS = process.env.IMAP_PASS!;
const APP = process.env.FLOWDESK_URL ?? "http://localhost:3100";
const INBOUND = process.env.INBOUND_ADDRESS!;
const SECRET = process.env.INBOUND_WEBHOOK_SECRET;

function argFlag(name: string): boolean { return process.argv.includes(name); }
function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function fetchRecent(client: ImapFlow, mailbox: string, n = 20): Promise<(MailEnvelope & { seq: number; bodyText?: string })[]> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const status = await client.status(mailbox, { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) return [];
    const from = Math.max(1, total - n + 1);
    const out: (MailEnvelope & { seq: number })[] = [];
    for await (const msg of client.fetch(`${from}:${total}`, { envelope: true, headers: ["references", "in-reply-to"] })) {
      const h = msg.headers?.toString() ?? "";
      const ref = /references:\s*([^\r\n]+)/i.exec(h)?.[1] ?? null;
      const irt = /in-reply-to:\s*([^\r\n]+)/i.exec(h)?.[1] ?? null;
      out.push({
        seq: msg.seq,
        messageId: msg.envelope?.messageId?.replace(/^<|>$/g, "") ?? `local-${msg.seq}`,
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

async function fetchBody(client: ImapFlow, mailbox: string, seq: number): Promise<string> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const msg = await client.fetchOne(String(seq), { bodyParts: ["text"] });
    const part = msg && typeof msg === "object" ? msg.bodyParts?.get("text") : null;
    return part ? part.toString("utf8") : "";
  } finally {
    lock.release();
  }
}

async function post(payload: unknown): Promise<void> {
  const res = await fetch(`${APP}/api/inbound-email`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(SECRET ? { "x-inbound-secret": SECRET } : {}) },
    body: JSON.stringify(payload),
  });
  console.log("→", res.status, await res.text());
}

async function main() {
  for (const [k, v] of Object.entries({ IMAP_HOST: HOST, IMAP_USER: USER, IMAP_PASS: PASS, INBOUND_ADDRESS: INBOUND })) {
    if (!v) { console.error(`환경변수 ${k} 필요`); process.exit(1); }
  }
  const client = new ImapFlow({ host: HOST, port: Number(process.env.IMAP_PORT ?? 993), secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await client.connect();
  try {
    const boxes = await client.list();
    const sent = pickSentMailbox(boxes.map((b) => ({ path: b.path, specialUse: b.specialUse })));
    if (argFlag("--list")) {
      if (!sent) { console.error("보낸편지함을 찾지 못했습니다:", boxes.map((b) => b.path).join(", ")); return; }
      const mails = await fetchRecent(client, sent);
      for (const [i, m] of mails.entries()) console.log(formatMailRow(i, m));
      console.log(`\n등록: --register <번호>  (본문 포함: --with-body)`);
    } else if (argValue("--register") != null) {
      if (!sent) { console.error("보낸편지함 없음"); return; }
      const idx = Number(argValue("--register"));
      const mails = await fetchRecent(client, sent);
      const m = mails[idx];
      if (!m) { console.error("잘못된 번호"); return; }
      const body = argFlag("--with-body") ? await fetchBody(client, sent, m.seq) : null;
      await post(envelopeToIntakePayload(m, { inboundAddress: INBOUND, body }));
    } else if (argFlag("--sync-replies")) {
      const mails = await fetchRecent(client, "INBOX", 30);
      const replies = mails.filter((m) => m.inReplyTo || m.references);
      console.log(`받은편지함 최근 30건 중 답장 ${replies.length}건 → 파이프라인으로 (스레드 매칭 안 되면 서버가 무시)`);
      for (const m of replies) await post(envelopeToIntakePayload(m, { inboundAddress: INBOUND }));
    } else {
      console.log("옵션: --list | --register <n> [--with-body] | --sync-replies");
    }
  } finally {
    await client.logout();
  }
}

main().catch((e) => { console.error("FATAL", e.message ?? e); process.exit(1); });
