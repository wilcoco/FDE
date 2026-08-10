// Pure logic for email intake (CC push). No IO — fully unit-testable.
// The webhook route wires these to DB lookups.

export const INBOUND_DOMAIN = "in.flowdesk.app";

/** The company's CC address: {slug}-{token}@in.flowdesk.app */
export function inboundAddress(slug: string, token: string): string {
  return `${slug}-${token}@${INBOUND_DOMAIN}`;
}

/** Parse our inbound address out of a recipient list; returns {slug, token} or null. */
export function parseInboundAddress(recipients: string[]): { slug: string; token: string } | null {
  for (const raw of recipients) {
    // handle "Name <acme-x7k2@in.flowdesk.app>" and bare address forms
    const m = raw.match(/([a-z0-9-]+)-([a-z0-9]+)@in\.flowdesk\.app/i);
    if (m) return { slug: m[1].toLowerCase(), token: m[2] };
  }
  return null;
}

/** Normalize an email address (strip display name, lowercase). */
export function normalizeEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/**
 * Normalize a Message-ID: real mail headers wrap it in angle brackets
 * (`<abc@host>`), but thread refs are parsed bracket-free. Store and compare
 * the bare form everywhere or replies never match their SAY.
 */
export function normalizeMessageId(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

/**
 * Extract candidate parent Message-IDs from reply headers. In-Reply-To is the
 * direct parent; References lists the whole ancestry (last = nearest). We return
 * newest-first so the caller matches the closest known thread.
 */
export function extractThreadRefs(headers: { inReplyTo?: string | null; references?: string | null }): string[] {
  const parse = (s: string): string[] => {
    const out: string[] = [];
    for (const m of s.matchAll(/<([^>]+)>/g)) out.push(m[1].trim());
    if (!s.includes("<")) {
      for (const t of s.split(/\s+/)) if (t.includes("@")) out.push(t.trim());
    }
    return out;
  };
  // nearest ancestor first: In-Reply-To (direct parent), then References newest→oldest
  const ordered = [
    ...(headers.inReplyTo ? parse(headers.inReplyTo) : []),
    ...(headers.references ? parse(headers.references).reverse() : []),
  ];
  const seen = new Set<string>();
  return ordered.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

export interface InboundPayload {
  to: string[]; // recipient addresses (To + Cc)
  from: string; // sender
  subject: string;
  messageId: string; // this mail's Message-ID
  inReplyTo?: string | null;
  references?: string | null;
  text?: string | null; // body (may be withheld / stripped by caller)
  spf?: string | null; // verdict from the inbound service, e.g. "pass"
  dkim?: string | null;
}

export type RouteDecision =
  | { action: "reject"; reason: string }
  | { action: "create"; slug: string }
  | { action: "reply"; slug: string; parentMessageId: string };

/**
 * Decide what an inbound email should do, given lookup results the caller
 * provides. Pure — no DB access here.
 *
 * @param known  set of Message-IDs already tracked for this tenant (for reply matching)
 */
export function routeInboundEmail(
  p: InboundPayload,
  ctx: {
    tenantExists: boolean; // token resolved to a tenant
    senderIsMember: boolean; // From is an active member of that tenant
    known: Set<string>; // tenant's tracked thread Message-IDs
  },
): RouteDecision {
  const addr = parseInboundAddress(p.to);
  if (!addr) return { action: "reject", reason: "no_inbound_address" };
  if (!ctx.tenantExists) return { action: "reject", reason: "unknown_tenant" };
  // anti-spoof: authentication verdicts must not be a hard fail when present
  if (p.spf && p.spf.toLowerCase() === "fail") return { action: "reject", reason: "spf_fail" };
  if (p.dkim && p.dkim.toLowerCase() === "fail") return { action: "reject", reason: "dkim_fail" };

  // reply? match the nearest known ancestor. Replies are accepted from ANYONE
  // (most DOs come from outsiders — 거래처 답장); possession of the tracked
  // thread reference + the secret address is the authorization.
  for (const ref of extractThreadRefs({ inReplyTo: p.inReplyTo, references: p.references })) {
    if (ctx.known.has(ref)) return { action: "reply", slug: addr.slug, parentMessageId: ref };
  }

  // creating a NEW instruction (SAY) is member-only — outsiders can't inject
  if (!ctx.senderIsMember) return { action: "reject", reason: "sender_not_member" };
  return { action: "create", slug: addr.slug };
}

/**
 * The account-free counterparty of a SAY: the recipients the mail was sent to,
 * excluding our own inbound address and the sender themselves. These are the
 * people whose reply will be the DO — they need no account.
 */
export function counterpartyOf(to: string[], sender: string): string {
  const senderNorm = normalizeEmail(sender);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of to) {
    if (/@in\.flowdesk\.app/i.test(raw)) continue; // our intake address
    const e = normalizeEmail(raw);
    if (!e || e === senderNorm || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out.join(", ");
}

/** Metadata always kept; body only when the tenant opted in. */
export function selectStoredBody(rawText: string | null | undefined, storeBody: boolean): string {
  if (!storeBody) return "";
  return stripQuotedTail(rawText ?? "");
}

/** Remove the quoted previous-message tail and common signatures from a reply. */
export function stripQuotedTail(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    // typical quote lead-ins: "On ... wrote:", "-----Original", ">"
    if (/^On .+wrote:$/.test(line.trim())) break;
    if (/^-{3,}\s*(Original Message|원본 메시지)/i.test(line.trim())) break;
    if (/^보낸 사람:/.test(line.trim())) break;
    if (line.trim() === "--") break; // signature delimiter
    out.push(line);
  }
  return out.join("\n").trim();
}
