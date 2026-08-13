// 브라우저-로컬 Gmail 경로의 순수 헬퍼 — 이 코드는 사용자의 브라우저에서
// 실행된다. 원본 메일과 액세스 토큰은 브라우저 밖으로 나가지 않고, 사용자가
// "지시로 등록"을 눌러 고른 결과만 서버로 간다 (구글 restricted-scope 면제
// 조항의 "user-configured transmissions" 구조). No IO — fully testable.

import { normalizeMessageId, extractThreadRefs } from "./inbound-email";

export interface GmailHeader { name: string; value: string }
export interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}
export interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPayload;
}

/** Case-insensitive header lookup on a Gmail API message payload. */
export function headerOf(msg: GmailMessage, name: string): string {
  const want = name.toLowerCase();
  for (const h of msg.payload?.headers ?? []) {
    if (h.name.toLowerCase() === want) return h.value;
  }
  return "";
}

function b64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  // atob exists in browsers AND Node 18+; binary string → bytes
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gmail body data (base64url) → UTF-8 text. */
export function decodeBody(data: string): string {
  try {
    return new TextDecoder("utf-8").decode(b64UrlToBytes(data));
  } catch {
    return "";
  }
}

/** Strictly the first text/plain part, depth-first. */
function findPlainPart(payload?: GmailPayload): string {
  if (!payload) return "";
  const mime = (payload.mimeType ?? "").toLowerCase();
  if (mime.startsWith("text/plain") && payload.body?.data) return decodeBody(payload.body.data);
  for (const p of payload.parts ?? []) {
    const t = findPlainPart(p);
    if (t) return t;
  }
  return "";
}

/** First text/plain part — same policy as our POP3/IMAP path. The text/*
 * fallback applies ONLY to a single-part message (top level): inside a
 * multipart it would happily return the text/html sibling instead. */
export function extractPlainText(payload?: GmailPayload): string {
  const plain = findPlainPart(payload);
  if (plain) return plain;
  const mime = (payload?.mimeType ?? "").toLowerCase();
  if (payload && !payload.parts && payload.body?.data && mime.startsWith("text/")) return decodeBody(payload.body.data);
  return "";
}

/** What the browser UI needs from one mail — nothing more leaves this shape. */
export interface LocalEnvelope {
  id: string; // Gmail API message id (for the +본문 fetch)
  messageId: string; // bare RFC 5322 Message-ID
  subject: string;
  from: string;
  to: string[];
  date: string | null;
  /** candidate parent Message-IDs (reply detection) */
  refs: string[];
}

export function toEnvelope(msg: GmailMessage): LocalEnvelope {
  const to = headerOf(msg, "To");
  const cc = headerOf(msg, "Cc");
  const split = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: msg.id,
    messageId: normalizeMessageId(headerOf(msg, "Message-ID")) || `gmail-${msg.id}`,
    subject: headerOf(msg, "Subject"),
    from: headerOf(msg, "From"),
    to: [...split(to), ...split(cc)],
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    refs: extractThreadRefs({
      inReplyTo: headerOf(msg, "In-Reply-To") || null,
      references: headerOf(msg, "References") || null,
    }),
  };
}

/** Inbox envelopes that answer one of MY tracked, still-waiting SAYs. */
export function matchReplies(
  inbox: LocalEnvelope[],
  tracked: { msgId: string; instructionId: string; replied: boolean }[],
): { env: LocalEnvelope; instructionId: string }[] {
  const waiting = new Map(tracked.filter((t) => !t.replied).map((t) => [t.msgId, t.instructionId]));
  const out: { env: LocalEnvelope; instructionId: string }[] = [];
  for (const env of inbox) {
    for (const ref of env.refs) {
      const inst = waiting.get(ref);
      if (inst) {
        out.push({ env, instructionId: inst });
        waiting.delete(ref); // one card per instruction — first (newest) reply wins
        break;
      }
    }
  }
  return out;
}
