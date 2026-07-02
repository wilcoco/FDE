// Pure decision rules for the milestone (꼭지) lifecycle — no IO, fully unit-testable.
// Two concerns live here:
//   1. attention/nudge rules — what is overdue/stalled/neglected, who to nudge, when
//   2. the review-gate transition — who may mark DONE directly vs. submit for review

import type { MilestoneStatus } from "@prisma/client";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** ACTIVE/BLOCKED with no movement for this many days counts as stalled. */
export function stallDays(): number {
  const n = Number(process.env.STALL_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** REVIEW sitting unreviewed for this many days nudges the author. */
export const REVIEW_STALL_DAYS = 2;

/** Minimum gap between two nudges for the same milestone. */
export const NUDGE_INTERVAL_MS = DAY_MS;

export interface MilestoneSnapshot {
  status: MilestoneStatus;
  dueAt: Date | null;
  updatedAt: Date;
  submittedAt: Date | null;
  lastNudgeAt: Date | null;
}

export interface Attention {
  /** past due and not delivered */
  overdue: boolean;
  /** ACTIVE/BLOCKED with no movement for stallDays */
  stalled: boolean;
  /** REVIEW waiting on the author for REVIEW_STALL_DAYS */
  reviewNeglected: boolean;
}

export function classifyAttention(
  m: MilestoneSnapshot,
  now: Date,
  cfg: { stallDays?: number } = {},
): Attention {
  const sd = cfg.stallDays ?? stallDays();
  const overdue = m.dueAt != null && m.dueAt.getTime() < now.getTime() && m.status !== "DONE";
  const stalled =
    (m.status === "ACTIVE" || m.status === "BLOCKED") &&
    now.getTime() - m.updatedAt.getTime() >= sd * DAY_MS;
  const reviewNeglected =
    m.status === "REVIEW" &&
    m.submittedAt != null &&
    now.getTime() - m.submittedAt.getTime() >= REVIEW_STALL_DAYS * DAY_MS;
  return { overdue, stalled, reviewNeglected };
}

export function needsAttention(a: Attention): boolean {
  return a.overdue || a.stalled || a.reviewNeglected;
}

/** Nudge only when something needs attention AND we haven't nudged in the last interval. */
export function shouldNudge(m: MilestoneSnapshot, now: Date, cfg: { stallDays?: number } = {}): boolean {
  if (!needsAttention(classifyAttention(m, now, cfg))) return false;
  if (m.lastNudgeAt && now.getTime() - m.lastNudgeAt.getTime() < NUDGE_INTERVAL_MS) return false;
  return true;
}

/**
 * Who should hear about it. REVIEW waits on the AUTHOR (owner already did their
 * part); everything else goes to the owner, with the author copied so the
 * instruction issuer sees their say-do gap. Never notify the same person twice.
 */
export function nudgeRecipients(
  m: { status: MilestoneStatus; ownerId: string | null },
  authorId: string,
): string[] {
  if (m.status === "REVIEW") return [authorId];
  const ids = new Set<string>();
  if (m.ownerId) ids.add(m.ownerId);
  ids.add(authorId);
  return [...ids];
}

/** Korean reason line used in notifications and the attention card. */
export function attentionReason(a: Attention, m: MilestoneSnapshot, now: Date): string {
  const parts: string[] = [];
  if (a.overdue && m.dueAt) {
    const days = Math.max(1, Math.floor((now.getTime() - m.dueAt.getTime()) / DAY_MS));
    parts.push(`기한 ${days}일 지남`);
  }
  if (a.stalled) {
    const days = Math.floor((now.getTime() - m.updatedAt.getTime()) / DAY_MS);
    parts.push(m.status === "BLOCKED" ? `막힘 ${days}일 방치` : `${days}일째 무소식`);
  }
  if (a.reviewNeglected && m.submittedAt) {
    const days = Math.floor((now.getTime() - m.submittedAt.getTime()) / DAY_MS);
    parts.push(`검수 ${days}일 대기`);
  }
  return parts.join(" · ");
}

// ── review gate ───────────────────────────────────────────────────────────────

export interface StatusChange {
  /** status to persist */
  status: MilestoneStatus;
  /** true when this submission needs the author's check (notify them) */
  needsReview: boolean;
}

/**
 * Resolve a requested status change through the review gate.
 * Completing is a claim, not a fact: only the instruction author (or an admin)
 * turns a claim into DONE. Everyone else's "완료" becomes REVIEW.
 */
export function resolveStatusChange(
  requested: MilestoneStatus,
  actor: { isAuthor: boolean; isAdmin: boolean },
): StatusChange {
  if (requested === "DONE" && !(actor.isAuthor || actor.isAdmin)) {
    return { status: "REVIEW", needsReview: true };
  }
  // Requesting REVIEW explicitly is always "submit for the author's check".
  if (requested === "REVIEW") {
    return { status: "REVIEW", needsReview: true };
  }
  return { status: requested, needsReview: false };
}

/** May this actor approve/return a milestone under review? */
export function canReview(actor: { isAuthor: boolean; isAdmin: boolean }): boolean {
  return actor.isAuthor || actor.isAdmin;
}
