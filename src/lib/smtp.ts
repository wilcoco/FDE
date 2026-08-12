// Minimal SMTP submission client for compose-in-app (Option B). Sends through
// the USER'S OWN mail server, so recipients see a completely normal mail from
// the user's real address — FlowDesk just happens to be the composer, which
// is what lets the SAY be born tracked (we mint the Message-ID).
// Zero dependencies, same style as pop3.ts. 465 = implicit TLS; other ports
// connect plain and upgrade via STARTTLS when the server offers it.

import net from "node:net";
import tls from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** 사내 서버 자체서명 인증서 허용 — 사용자가 명시적으로 켠 경우만 true. */
  allowSelfSigned?: boolean;
  /**
   * Alternate AUTH usernames to retry on auth failure — servers disagree on
   * whether SMTP wants the bare id ("json") or the full address
   * ("json@icams.co.kr"), and often differ from their own POP3.
   */
  authAlternates?: string[];
}

export interface OutgoingMail {
  from: string; // bare address
  to: string[]; // bare addresses
  bcc?: string[]; // delivered but not shown in headers
  subject: string;
  text: string;
  messageId: string; // bare form, no angle brackets
}

const CONNECT_TIMEOUT = 10_000;
const COMMAND_TIMEOUT = 30_000;

function connError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** RFC2047 B-encode a header value when it contains non-ASCII (한글 제목). */
export function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Build the RFC822 message. Body goes base64 so 한글/줄바꿈 survive any relay. */
export function buildMessage(m: OutgoingMail, now = new Date()): string {
  const b64body = Buffer.from(m.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: <${m.from}>`,
    `To: ${m.to.map((a) => `<${a}>`).join(", ")}`,
    `Subject: ${encodeHeaderWord(m.subject)}`,
    `Message-ID: <${m.messageId}>`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset=utf-8',
    "Content-Transfer-Encoding: base64",
    "",
    b64body,
  ].join("\r\n");
}

interface Wire {
  send(line: string | null, expect: number[]): Promise<string>;
  upgrade(): Promise<void>; // STARTTLS
  destroy(): void;
}

async function openWire(host: string, port: number, allowSelfSigned = false): Promise<Wire> {
  let socket: net.Socket = await new Promise((resolve, reject) => {
    const isTls = port === 465;
    const s: net.Socket = isTls
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: !allowSelfSigned })
      : net.connect({ host, port });
    const timer = setTimeout(() => { s.destroy(); reject(connError("CONNECT_TIMEOUT", "Failed to establish connection in required time")); }, CONNECT_TIMEOUT);
    s.once(isTls ? "secureConnect" : "connect", () => { clearTimeout(timer); resolve(s); });
    s.once("error", (e) => { clearTimeout(timer); reject(e); });
  });

  let buffer = "";
  let waiter: { resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  const attach = (s: net.Socket) => {
    s.on("data", (d) => {
      buffer += d.toString();
      // SMTP multi-line replies: final line is "250 text" — or bare "250"
      // (RFC 5321 allows omitting the text; "250-" continues, "250 "/"250" ends)
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3}( |$)/.test(last) && waiter) {
        const w = waiter; waiter = null;
        clearTimeout(w.timer);
        const whole = buffer; buffer = "";
        w.resolve(whole);
      }
    });
    s.on("error", (e) => { if (waiter) { const w = waiter; waiter = null; clearTimeout(w.timer); w.reject(e as Error); } });
  };
  attach(socket);

  const read = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiter = null; reject(connError("ETIMEDOUT", "smtp timeout")); }, COMMAND_TIMEOUT);
      waiter = { resolve, reject, timer };
    });

  return {
    async send(line: string | null, expect: number[]): Promise<string> {
      const pending = read();
      if (line != null) socket.write(line + "\r\n");
      const res = await pending;
      const code = Number(res.slice(0, 3));
      if (!expect.includes(code)) {
        const err = connError("ERR_RESPONSE", res.trim().slice(0, 200)) as Error & { code: string; authenticationFailed?: boolean; smtpCode?: number };
        err.smtpCode = code;
        // 535/534/530 are the standard auth-failure codes; legacy servers
        // (Nmail) also say things like "503 Authentication failed"
        if (code === 535 || code === 534 || code === 530 || /authentication/i.test(res)) err.authenticationFailed = true;
        throw err;
      }
      return res;
    },
    async upgrade(): Promise<void> {
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      const upgraded: tls.TLSSocket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host, rejectUnauthorized: !allowSelfSigned }, () => resolve(t));
        t.once("error", reject);
      });
      socket = upgraded;
      attach(socket);
    },
    destroy() { socket.destroy(); },
  };
}

/** Send one mail. Throws with classifiable codes (CONNECT_TIMEOUT / auth / ERR_RESPONSE). */
export async function smtpSend(cfg: SmtpConfig, mail: OutgoingMail): Promise<void> {
  const wire = await openWire(cfg.host, cfg.port, cfg.allowSelfSigned);
  try {
    await wire.send(null, [220]); // greeting
    let ehlo = await wire.send(`EHLO flowdesk.local`, [250]);
    if (cfg.port !== 465 && /STARTTLS/i.test(ehlo)) {
      await wire.send("STARTTLS", [220]);
      await wire.upgrade();
      ehlo = await wire.send(`EHLO flowdesk.local`, [250]);
    }
    // AUTH: try each username form (bare id vs full address — servers differ,
    // and often differ from their own POP3). A server without AUTH answers the
    // verb with 500/502; that's fine — POP-before-SMTP may authorize instead.
    const candidates = [cfg.user, ...(cfg.authAlternates ?? [])]
      .map((u) => u.trim()).filter(Boolean)
      .filter((u, i, arr) => arr.indexOf(u) === i);
    const advertised = /AUTH[ =][^\r\n]*(LOGIN|PLAIN)/i.test(ehlo);
    let lastAuthErr: unknown = null;
    for (const [i, candidate] of candidates.entries()) {
      try {
        await wire.send("AUTH LOGIN", [334]);
        await wire.send(Buffer.from(candidate).toString("base64"), [334]);
        await wire.send(Buffer.from(cfg.pass).toString("base64"), [235]);
        lastAuthErr = null;
        break;
      } catch (e) {
        const code = (e as { smtpCode?: number }).smtpCode ?? 0;
        // 500/502 = no such verb → server has no AUTH at all; stop trying
        if (code === 500 || code === 502) { lastAuthErr = null; break; }
        lastAuthErr = e;
        if (i === candidates.length - 1 && advertised) throw e; // all forms rejected
      }
    }
    // AUTH not advertised and all attempts bounced → proceed unauthenticated;
    // if the server truly requires auth, MAIL FROM will say so explicitly
    void lastAuthErr;

    await wire.send(`MAIL FROM:<${mail.from}>`, [250]);
    for (const rcpt of [...mail.to, ...(mail.bcc ?? [])]) {
      await wire.send(`RCPT TO:<${rcpt}>`, [250, 251]);
    }
    await wire.send("DATA", [354]);
    const message = buildMessage(mail);
    // dot-stuffing + terminator
    const stuffed = message.replace(/(^|\r\n)\./g, "$1..");
    await wire.send(stuffed + "\r\n.", [250]);
    await wire.send("QUIT", [221]).catch(() => {});
  } finally {
    wire.destroy();
  }
}

/**
 * Derive SMTP endpoint from the incoming-mail host when the user didn't set
 * one. Known providers get their real submission host; company servers
 * usually run SMTP on the same box (587 = submission, STARTTLS).
 */
export function deriveSmtp(incomingHost: string): { host: string; port: number } {
  const known: Record<string, { host: string; port: number }> = {
    "imap.naver.com": { host: "smtp.naver.com", port: 465 },
    "imap.gmail.com": { host: "smtp.gmail.com", port: 465 },
    "pop.gmail.com": { host: "smtp.gmail.com", port: 465 },
    "imap.daum.net": { host: "smtp.daum.net", port: 465 },
  };
  const hit = known[incomingHost.toLowerCase()];
  if (hit) return hit;
  return { host: incomingHost, port: 587 };
}
