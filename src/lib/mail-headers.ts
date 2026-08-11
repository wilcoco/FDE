// Pure parsing for raw RFC822 mail: header block → envelope, RFC2047
// encoded-words (한글 제목: UTF-8/EUC-KR × B/Q), and a pragmatic text-part
// extractor for per-mail body opt-in. No IO — fully unit-testable.

import type { MailEnvelope } from "./connector";

/** Decode one RFC2047 encoded-word run: =?charset?B|Q?data?= */
export function decodeWords(input: string): string {
  if (!input.includes("=?")) return input;
  // adjacent encoded-words are joined without the whitespace between them
  const joined = input.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    try {
      let bytes: Buffer;
      if (enc.toLowerCase() === "b") {
        bytes = Buffer.from(data, "base64");
      } else {
        // Q-encoding: underscore = space, =XX = byte
        const qp = data.replace(/_/g, " ");
        bytes = Buffer.from(qp.replace(/=([0-9A-Fa-f]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16))), "binary");
      }
      return decodeCharset(bytes, charset);
    } catch {
      return _m; // leave undecodable runs visible rather than dropping them
    }
  });
}

function decodeCharset(bytes: Buffer, charset: string): string {
  const cs = charset.trim().toLowerCase().replace(/^ks_c_5601.*/, "euc-kr").replace(/^cp949$/, "euc-kr");
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Parse a raw header block: unfold continuations, first value wins per name. */
export function parseHeaders(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/** Split "a@x, B <b@y>" respecting nothing fancy — good enough for To/Cc lists. */
function splitAddresses(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Raw header block → the envelope shape the intake pipeline uses. */
export function headersToEnvelope(rawHeaders: string, fallbackId: string): MailEnvelope {
  const h = parseHeaders(rawHeaders);
  const to = [...splitAddresses(h.get("to") ?? ""), ...splitAddresses(h.get("cc") ?? "")];
  let date: string | null = null;
  const d = h.get("date");
  if (d) {
    const t = new Date(d);
    if (!Number.isNaN(t.getTime())) date = t.toISOString();
  }
  return {
    messageId: (h.get("message-id") ?? "").replace(/^<|>$/g, "").trim() || fallbackId,
    inReplyTo: h.get("in-reply-to") ?? null,
    references: h.get("references") ?? null,
    subject: decodeWords(h.get("subject") ?? "") || null,
    from: decodeWords(h.get("from") ?? "") || null,
    to,
    date,
  };
}

/**
 * Extract readable text from a full raw message (headers + body).
 * Handles: plain text bodies, base64/quoted-printable transfer encoding,
 * charset via TextDecoder (utf-8, euc-kr, …), and one level of multipart
 * (first text/plain part wins). Anything weirder returns "" — the caller
 * treats that as "no body stored", never as an error.
 */
export function extractTextBody(rawMessage: string): string {
  const sep = rawMessage.search(/\r?\n\r?\n/);
  if (sep < 0) return "";
  const headRaw = rawMessage.slice(0, sep);
  let body = rawMessage.slice(sep).replace(/^\r?\n\r?\n/, "");
  const h = parseHeaders(headRaw);
  let ctype = h.get("content-type") ?? "text/plain";
  let cte = (h.get("content-transfer-encoding") ?? "7bit").toLowerCase();

  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ctype);
  if (/multipart\//i.test(ctype) && boundaryMatch) {
    const parts = body.split(new RegExp(`--${escapeRe(boundaryMatch[1])}(?:--)?\\r?\\n?`));
    let found: string | null = null;
    for (const part of parts) {
      const pSep = part.search(/\r?\n\r?\n/);
      if (pSep < 0) continue;
      const pHead = parseHeaders(part.slice(0, pSep));
      const pType = pHead.get("content-type") ?? "text/plain";
      if (/text\/plain/i.test(pType)) {
        found = part.slice(pSep).replace(/^\r?\n\r?\n/, "");
        ctype = pType;
        cte = (pHead.get("content-transfer-encoding") ?? "7bit").toLowerCase();
        break;
      }
    }
    if (found == null) return "";
    body = found;
  } else if (!/text\//i.test(ctype)) {
    return "";
  }

  let bytes: Buffer;
  if (cte === "base64") {
    bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  } else if (cte === "quoted-printable") {
    bytes = Buffer.from(
      body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_s, x: string) => String.fromCharCode(parseInt(x, 16))),
      "binary",
    );
  } else {
    bytes = Buffer.from(body, "binary");
  }
  const charset = /charset="?([^";]+)"?/i.exec(ctype)?.[1] ?? "utf-8";
  return decodeCharset(bytes, charset).trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
