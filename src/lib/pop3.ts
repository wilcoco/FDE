// Minimal POP3 client — enough for the in-app mail screen against servers
// that have no IMAP at all (Nmail 등 국산 POP3-전용 메일서버).
// Privacy: TOP n 0 fetches HEADERS ONLY at the protocol level; RETR (full
// body) runs only on per-mail opt-in.

import net from "node:net";
import tls from "node:tls";

export interface Pop3Conn {
  host: string;
  port: number; // 995 = implicit TLS, anything else = plaintext
  user: string;
  pass: string;
}

const CONNECT_TIMEOUT = 10_000;
const COMMAND_TIMEOUT = 20_000;

interface Session {
  cmd(line: string): Promise<string>; // single-line response (+OK ... / throws on -ERR)
  cmdMulti(line: string): Promise<string>; // multi-line response body (after +OK, until ".")
  close(): Promise<void>;
}

function connError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function open(conn: Pop3Conn): Promise<Session> {
  const socket: net.Socket = await new Promise((resolve, reject) => {
    const isTls = conn.port === 995;
    const s: net.Socket = isTls
      ? tls.connect({ host: conn.host, port: conn.port, servername: conn.host })
      : net.connect({ host: conn.host, port: conn.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(connError("CONNECT_TIMEOUT", "Failed to establish connection in required time"));
    }, CONNECT_TIMEOUT);
    s.once(isTls ? "secureConnect" : "connect", () => { clearTimeout(timer); resolve(s); });
    s.once("error", (e) => { clearTimeout(timer); reject(e); });
  });

  // line-buffered reader with a promise queue
  let buffer = Buffer.alloc(0);
  const waiters: { until: (buf: Buffer) => number; resolve: (chunk: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  const pump = () => {
    while (waiters.length) {
      const w = waiters[0];
      const end = w.until(buffer);
      if (end < 0) return;
      const chunk = buffer.subarray(0, end);
      buffer = buffer.subarray(end);
      waiters.shift();
      clearTimeout(w.timer);
      w.resolve(chunk);
    }
  };
  socket.on("data", (d) => { buffer = Buffer.concat([buffer, d]); pump(); });
  socket.on("error", (e) => { for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(e as Error); } });
  socket.on("close", () => { for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(connError("ECONNRESET", "connection closed")); } });

  const read = (until: (buf: Buffer) => number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) waiters.splice(i, 1);
        reject(connError("ETIMEDOUT", "command timeout"));
      }, COMMAND_TIMEOUT);
      waiters.push({ until, resolve, reject, timer });
      pump();
    });

  const untilLine = (buf: Buffer): number => {
    const i = buf.indexOf("\r\n");
    return i < 0 ? -1 : i + 2;
  };
  // multiline terminator: CRLF.CRLF (or leading ".CRLF" right after status line)
  const untilDot = (buf: Buffer): number => {
    const i = buf.indexOf("\r\n.\r\n");
    if (i >= 0) return i + 5;
    if (buf.subarray(0, 3).toString() === ".\r\n") return 3;
    return -1;
  };

  // greeting
  const greeting = (await read(untilLine)).toString();
  if (!greeting.startsWith("+OK")) { socket.destroy(); throw connError("EPROTO", `bad greeting: ${greeting.trim()}`); }

  return {
    async cmd(line: string): Promise<string> {
      socket.write(line + "\r\n");
      const res = (await read(untilLine)).toString().trim();
      if (!res.startsWith("+OK")) {
        const err = connError("ERR_RESPONSE", res) as Error & { code: string; authenticationFailed?: boolean };
        if (/^(USER|PASS)/i.test(line)) err.authenticationFailed = true;
        throw err;
      }
      return res;
    },
    async cmdMulti(line: string): Promise<string> {
      socket.write(line + "\r\n");
      const status = (await read(untilLine)).toString().trim();
      if (!status.startsWith("+OK")) throw connError("ERR_RESPONSE", status);
      const raw = (await read(untilDot)).toString("binary");
      // strip terminator + undo dot-stuffing
      return raw.replace(/\r\n\.\r\n$/, "").replace(/^\.\r\n$/, "").replace(/(^|\r\n)\.\./g, "$1.");
    },
    async close(): Promise<void> {
      try { socket.write("QUIT\r\n"); } catch { /* closing anyway */ }
      socket.destroy();
    },
  };
}

async function login(conn: Pop3Conn): Promise<Session> {
  const s = await open(conn);
  try {
    await s.cmd(`USER ${conn.user}`);
    await s.cmd(`PASS ${conn.pass}`);
    return s;
  } catch (e) {
    await s.close();
    throw e;
  }
}

/** Verify credentials (USER/PASS/QUIT). Throws with authenticationFailed on bad login. */
export async function pop3Test(conn: Pop3Conn): Promise<void> {
  const s = await login(conn);
  await s.close();
}

export interface Pop3Mail {
  seq: number; // message number in THIS session (unstable across sessions)
  uid: string; // UIDL — stable id, use for cross-session fetch
  rawHeaders: string; // header block only (TOP n 0)
}

/** Headers of the most recent `n` messages — protocol-level metadata-only. */
export async function pop3ListRecent(conn: Pop3Conn, n = 20): Promise<Pop3Mail[]> {
  const s = await login(conn);
  try {
    const stat = await s.cmd("STAT"); // "+OK <count> <size>"
    const total = Number(stat.split(/\s+/)[1] ?? 0);
    if (!total) return [];
    const from = Math.max(1, total - n + 1);

    const uidl = new Map<number, string>();
    const uidlRaw = await s.cmdMulti("UIDL").catch(() => "");
    for (const line of uidlRaw.split("\r\n")) {
      const [num, uid] = line.trim().split(/\s+/);
      if (num && uid) uidl.set(Number(num), uid);
    }

    const out: Pop3Mail[] = [];
    for (let i = total; i >= from; i--) {
      const rawHeaders = await s.cmdMulti(`TOP ${i} 0`).catch(() => "");
      if (rawHeaders) out.push({ seq: i, uid: uidl.get(i) ?? `seq-${i}`, rawHeaders });
    }
    return out; // newest first
  } finally {
    await s.close();
  }
}

/** Full raw message by UIDL — per-mail body opt-in only. */
export async function pop3FetchRaw(conn: Pop3Conn, uid: string): Promise<string> {
  const s = await login(conn);
  try {
    const uidlRaw = await s.cmdMulti("UIDL");
    let seq = 0;
    for (const line of uidlRaw.split("\r\n")) {
      const [num, u] = line.trim().split(/\s+/);
      if (u === uid) { seq = Number(num); break; }
    }
    if (!seq) return "";
    return await s.cmdMulti(`RETR ${seq}`);
  } finally {
    await s.close();
  }
}
