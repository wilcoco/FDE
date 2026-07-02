// Stall/overdue sweep — the "say-do gap" watchdog.
// Finds milestones that are overdue, stalled, or sitting unreviewed, and nudges
// the right people (in-app + email). Runs lazily on app activity (throttled per
// tenant) and via `npm run jobs:sweep` for a real cron.

import { prisma } from "./db";
import { notify } from "./notify";
import { sendNotificationEmail } from "./mail";
import {
  classifyAttention,
  attentionReason,
  needsAttention,
  shouldNudge,
  nudgeRecipients,
} from "./milestone-rules";

const SWEEP_THROTTLE_MS = 10 * 60 * 1000; // at most one lazy sweep per tenant / 10min

export interface SweepResult {
  scanned: number;
  nudged: number;
}

/** Nudge every milestone of this tenant that needs attention. Idempotent per 24h. */
export async function sweepTenant(tenantId: string, now = new Date()): Promise<SweepResult> {
  const candidates = await prisma.milestone.findMany({
    where: {
      tenantId,
      instruction: { status: "ACTIVE" },
      // PENDING is included so a due date passing before anyone even starts
      // ("지시했는데 시작도 안 함") still raises a nudge.
      OR: [
        { status: { in: ["ACTIVE", "BLOCKED", "REVIEW"] } },
        { status: "PENDING", dueAt: { not: null } },
      ],
    },
    include: {
      instruction: { select: { id: true, authorId: true, summary: true } },
      owner: { select: { id: true, email: true, status: true } },
    },
  });

  let nudged = 0;
  for (const m of candidates) {
    if (!shouldNudge(m, now)) continue;
    const a = classifyAttention(m, now);
    const reason = attentionReason(a, m, now);
    const recipientIds = nudgeRecipients(m, m.instruction.authorId);

    const users = await prisma.user.findMany({
      where: { id: { in: recipientIds }, status: "ACTIVE" },
      select: { id: true, email: true },
    });
    if (users.length === 0) continue;

    for (const u of users) {
      await notify(prisma, {
        tenantId,
        userId: u.id,
        type: "MILESTONE_NUDGE",
        title: `⏰ 꼭지 확인 필요: ${m.title}`,
        body: `${reason} — ${m.instruction.summary ?? "지시"}`,
        link: `/instructions/${m.instruction.id}`,
      });
      void sendNotificationEmail(u.email, {
        title: `꼭지 확인 필요: ${m.title}`,
        body: `${reason} — ${m.instruction.summary ?? "지시"}`,
        link: `/instructions/${m.instruction.id}`,
      }).catch(() => {});
    }

    await prisma.milestone.update({ where: { id: m.id }, data: { lastNudgeAt: now } });
    nudged++;
  }

  return { scanned: candidates.length, nudged };
}

/**
 * Lazy sweep: called from page loads. Claims the sweep slot atomically
 * (updateMany with a time guard) so concurrent requests don't double-run.
 */
export async function maybeSweep(tenantId: string): Promise<void> {
  try {
    const now = new Date();
    const threshold = new Date(now.getTime() - SWEEP_THROTTLE_MS);
    const claimed = await prisma.tenant.updateMany({
      where: {
        id: tenantId,
        OR: [{ lastSweepAt: null }, { lastSweepAt: { lt: threshold } }],
      },
      data: { lastSweepAt: now },
    });
    if (claimed.count === 0) return; // someone else swept recently
    await sweepTenant(tenantId, now);
  } catch (e) {
    // never let the watchdog take a page render down with it
    console.error("[sweep] failed", e);
  }
}

/** Attention summary for the dashboard card (read-only; no nudging). */
export async function attentionSummary(tenantId: string, userId: string, now = new Date()) {
  const milestones = await prisma.milestone.findMany({
    where: {
      tenantId,
      instruction: { status: "ACTIVE" },
      AND: [
        {
          OR: [
            { status: { in: ["ACTIVE", "BLOCKED", "REVIEW"] } },
            { status: "PENDING", dueAt: { not: null } },
          ],
        },
        { OR: [{ ownerId: userId }, { instruction: { authorId: userId } }] },
      ],
    },
    include: {
      instruction: { select: { id: true, authorId: true, summary: true } },
      owner: { select: { name: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const items = milestones
    .map((m) => ({ m, a: classifyAttention(m, now) }))
    .filter(({ a }) => needsAttention(a))
    .map(({ m, a }) => ({
      id: m.id,
      title: m.title,
      instructionId: m.instruction.id,
      instructionSummary: m.instruction.summary,
      ownerName: m.owner?.name ?? null,
      status: m.status,
      reason: attentionReason(a, m, now),
    }));

  const reviewQueue = milestones.filter(
    (m) => m.status === "REVIEW" && m.instruction.authorId === userId,
  ).length;

  return { items, reviewQueue };
}
