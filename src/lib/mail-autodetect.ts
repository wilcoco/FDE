// Auto-detection of mail endpoints from just an email address. The setup UX
// becomes "이메일 + 비밀번호" — known providers resolve instantly; company
// domains get MX-informed candidates probed in parallel (IMAP preferred,
// POP3 fallback), and an SMTP endpoint is discovered the same way.

import net from "node:net";
import { promises as dns } from "node:dns";

export interface Endpoint {
  host: string;
  port: number;
}

/** Known consumer/workspace providers — no probing needed. */
const KNOWN: Record<string, { in: Endpoint; smtp: Endpoint }> = {
  "naver.com": { in: { host: "imap.naver.com", port: 993 }, smtp: { host: "smtp.naver.com", port: 465 } },
  "gmail.com": { in: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 } },
  "daum.net": { in: { host: "imap.daum.net", port: 993 }, smtp: { host: "smtp.daum.net", port: 465 } },
  "hanmail.net": { in: { host: "imap.daum.net", port: 993 }, smtp: { host: "smtp.daum.net", port: 465 } },
  "kakao.com": { in: { host: "imap.kakao.com", port: 993 }, smtp: { host: "smtp.kakao.com", port: 465 } },
  "outlook.com": { in: { host: "outlook.office365.com", port: 993 }, smtp: { host: "smtp-mail.outlook.com", port: 587 } },
  "hotmail.com": { in: { host: "outlook.office365.com", port: 993 }, smtp: { host: "smtp-mail.outlook.com", port: 587 } },
};

export function knownProvider(domain: string): { in: Endpoint; smtp: Endpoint } | null {
  return KNOWN[domain.toLowerCase()] ?? null;
}

/**
 * Ordered candidate hosts for a company domain: the conventional names first,
 * then MX targets (dedup, keep order). Pure — MX hosts are passed in.
 */
export function candidateHosts(domain: string, mxHosts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [`mail.${domain}`, `imap.${domain}`, `pop.${domain}`, ...mxHosts, domain]) {
    const k = h.toLowerCase().replace(/\.$/, "");
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** Incoming-mail ports in preference order: IMAP first, then POP3. */
export const IN_PORTS = [993, 143, 995, 110];
/** SMTP submission ports in preference order (25 omitted — clouds block it). */
export const SMTP_PORTS = [465, 587];

export async function resolveMxHosts(domain: string): Promise<string[]> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  } catch {
    return [];
  }
}

/** Fast TCP reachability check — resolves true iff something accepts the connection. */
export function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    s.once("connect", () => { clearTimeout(timer); done(true); });
    s.once("error", () => { clearTimeout(timer); done(false); });
  });
}

export interface DetectResult {
  incoming: Endpoint | null;
  smtp: Endpoint | null;
  tried: string[]; // "host:port" attempts, for the error message
}

/**
 * Detect endpoints for an address. Known providers return instantly; company
 * domains probe candidates in parallel and pick by preference order.
 */
export async function detectEndpoints(email: string): Promise<DetectResult> {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return { incoming: null, smtp: null, tried: [] };

  const known = knownProvider(domain);
  if (known) return { incoming: known.in, smtp: known.smtp, tried: [] };

  const hosts = candidateHosts(domain, await resolveMxHosts(domain));
  const attempts: { host: string; port: number; ok: boolean }[] = [];

  // probe everything in parallel (hosts × ports is small), then pick in order
  await Promise.all(
    hosts.flatMap((host) =>
      [...IN_PORTS, ...SMTP_PORTS].map(async (port) => {
        const ok = await tcpProbe(host, port);
        attempts.push({ host, port, ok });
      }),
    ),
  );

  const pick = (ports: number[]): Endpoint | null => {
    for (const host of hosts) {
      for (const port of ports) {
        if (attempts.find((a) => a.host === host && a.port === port && a.ok)) return { host, port };
      }
    }
    return null;
  };

  return {
    incoming: pick(IN_PORTS),
    smtp: pick(SMTP_PORTS),
    tried: attempts.filter((a) => !a.ok).map((a) => `${a.host}:${a.port}`),
  };
}
