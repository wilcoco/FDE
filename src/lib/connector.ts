// Pure logic for the LOCAL mail connector (desktop / CLI). The connector reads
// the user's own mailbox on their machine and feeds selected mails into the
// same intake pipeline as the CC webhook — metadata-only by default; the body
// is included ONLY for a mail the user explicitly opts in (per-mail consent).
// No IO here — fully unit-testable.

import type { InboundPayload } from "./inbound-email";

/** Minimal envelope shape we need from an IMAP fetch (imapflow-compatible). */
export interface MailEnvelope {
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null; // from raw headers when available
  subject?: string | null;
  from?: string | null; // "Name <addr>" or bare
  to?: string[] | null;
  date?: string | null; // ISO
}

/**
 * Build the intake payload the /api/inbound-email pipeline expects.
 * The tenant's secret inbound address is appended as a recipient — same
 * authorization model as the CC flow (possession of the address).
 * `body` is null unless the user opted this specific mail in.
 */
export function envelopeToIntakePayload(
  env: MailEnvelope,
  opts: { inboundAddress: string; body?: string | null },
): InboundPayload {
  return {
    to: [...(env.to ?? []), opts.inboundAddress],
    from: env.from ?? "",
    subject: env.subject ?? "(제목 없음)",
    messageId: env.messageId,
    inReplyTo: env.inReplyTo ?? null,
    references: env.references ?? null,
    text: opts.body ?? null, // null → pipeline stores metadata only
    spf: null, // local connector is trusted transport; absent ≠ fail
    dkim: null,
  };
}

/** Pick the sent-mail folder from an IMAP mailbox list (special-use first). */
export function pickSentMailbox(
  boxes: { path: string; specialUse?: string | null }[],
): string | null {
  const bySpecial = boxes.find((b) => b.specialUse === "\\Sent");
  if (bySpecial) return bySpecial.path;
  const NAMES = ["Sent", "Sent Messages", "Sent Items", "[Gmail]/Sent Mail", "보낸편지함", "보낸 편지함"];
  for (const n of NAMES) {
    const hit = boxes.find((b) => b.path === n || b.path.endsWith(`/${n}`));
    if (hit) return hit.path;
  }
  return null;
}

/** One-line row for the CLI list view. */
export function formatMailRow(i: number, env: MailEnvelope): string {
  const date = env.date ? env.date.slice(0, 10) : "????-??-??";
  const to = (env.to ?? []).map((t) => t.replace(/<|>/g, "")).slice(0, 2).join(", ");
  return `[${String(i).padStart(2)}] ${date}  → ${to || "?"}  ${env.subject ?? "(제목 없음)"}`;
}
