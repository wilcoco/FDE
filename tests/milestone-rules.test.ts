/**
 * Adversarial unit tests for the pure milestone lifecycle rules.
 * Focus: boundary times, permission edge cases, dedup logic, clock skew.
 */
import assert from "node:assert/strict";
import {
  classifyAttention,
  shouldNudge,
  nudgeRecipients,
  attentionReason,
  resolveStatusChange,
  canReview,
  needsAttention,
  stallDays,
  DAY_MS,
  NUDGE_INTERVAL_MS,
  type MilestoneSnapshot,
} from "../src/lib/milestone-rules";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

function snap(over: Partial<MilestoneSnapshot>): MilestoneSnapshot {
  return {
    status: "ACTIVE",
    dueAt: null,
    updatedAt: ago(60_000), // fresh by default
    submittedAt: null,
    lastNudgeAt: null,
    ...over,
  };
}

export async function run(t: (name: string, fn: () => void) => void) {
  // ── overdue ──────────────────────────────────────────────────────────────
  t("DONE past due is NOT overdue", () => {
    const a = classifyAttention(snap({ status: "DONE", dueAt: ago(5 * DAY_MS) }), NOW);
    assert.equal(a.overdue, false);
  });
  t("due exactly now is NOT overdue (strict <)", () => {
    const a = classifyAttention(snap({ dueAt: NOW }), NOW);
    assert.equal(a.overdue, false);
  });
  t("due 1ms in the past IS overdue", () => {
    const a = classifyAttention(snap({ dueAt: ago(1) }), NOW);
    assert.equal(a.overdue, true);
  });
  t("PENDING with passed due IS overdue (지시했는데 시작도 안 함)", () => {
    const a = classifyAttention(snap({ status: "PENDING", dueAt: ago(DAY_MS) }), NOW);
    assert.equal(a.overdue, true);
    assert.equal(a.stalled, false); // PENDING is never 'stalled'
  });
  t("REVIEW with passed due IS overdue", () => {
    const a = classifyAttention(
      snap({ status: "REVIEW", dueAt: ago(DAY_MS), submittedAt: ago(60_000) }),
      NOW,
    );
    assert.equal(a.overdue, true);
  });
  t("no dueAt never overdue", () => {
    const a = classifyAttention(snap({ dueAt: null, updatedAt: ago(30 * DAY_MS) }), NOW);
    assert.equal(a.overdue, false);
  });

  // ── stalled ──────────────────────────────────────────────────────────────
  t("ACTIVE untouched exactly 3d IS stalled (>=)", () => {
    const a = classifyAttention(snap({ updatedAt: ago(3 * DAY_MS) }), NOW, { stallDays: 3 });
    assert.equal(a.stalled, true);
  });
  t("ACTIVE untouched 3d-1ms is NOT stalled", () => {
    const a = classifyAttention(snap({ updatedAt: ago(3 * DAY_MS - 1) }), NOW, { stallDays: 3 });
    assert.equal(a.stalled, false);
  });
  t("BLOCKED neglected IS stalled", () => {
    const a = classifyAttention(snap({ status: "BLOCKED", updatedAt: ago(4 * DAY_MS) }), NOW);
    assert.equal(a.stalled, true);
  });
  t("PENDING/DONE/REVIEW never 'stalled'", () => {
    for (const status of ["PENDING", "DONE", "REVIEW"] as const) {
      const a = classifyAttention(
        snap({ status, updatedAt: ago(30 * DAY_MS), submittedAt: null }),
        NOW,
      );
      assert.equal(a.stalled, false, status);
    }
  });
  t("custom stallDays=1 works", () => {
    const a = classifyAttention(snap({ updatedAt: ago(DAY_MS) }), NOW, { stallDays: 1 });
    assert.equal(a.stalled, true);
  });

  // ── review neglect ───────────────────────────────────────────────────────
  t("REVIEW submitted exactly 2d ago IS neglected", () => {
    const a = classifyAttention(snap({ status: "REVIEW", submittedAt: ago(2 * DAY_MS) }), NOW);
    assert.equal(a.reviewNeglected, true);
  });
  t("REVIEW submitted 2d-1ms ago is NOT neglected", () => {
    const a = classifyAttention(snap({ status: "REVIEW", submittedAt: ago(2 * DAY_MS - 1) }), NOW);
    assert.equal(a.reviewNeglected, false);
  });
  t("REVIEW without submittedAt (dirty data) does not crash, not neglected", () => {
    const a = classifyAttention(snap({ status: "REVIEW", submittedAt: null }), NOW);
    assert.equal(a.reviewNeglected, false);
  });
  t("non-REVIEW with old submittedAt (stale field) is NOT neglected", () => {
    const a = classifyAttention(snap({ status: "ACTIVE", submittedAt: ago(10 * DAY_MS) }), NOW);
    assert.equal(a.reviewNeglected, false);
  });

  // ── shouldNudge (dedup) ──────────────────────────────────────────────────
  t("attention + never nudged → nudge", () => {
    assert.equal(shouldNudge(snap({ dueAt: ago(DAY_MS) }), NOW), true);
  });
  t("attention + nudged 1ms under 24h ago → NO nudge", () => {
    assert.equal(
      shouldNudge(snap({ dueAt: ago(DAY_MS), lastNudgeAt: ago(NUDGE_INTERVAL_MS - 1) }), NOW),
      false,
    );
  });
  t("attention + nudged exactly 24h ago → nudge again", () => {
    assert.equal(
      shouldNudge(snap({ dueAt: ago(DAY_MS), lastNudgeAt: ago(NUDGE_INTERVAL_MS) }), NOW),
      true,
    );
  });
  t("no attention → never nudge even if never nudged", () => {
    assert.equal(shouldNudge(snap({}), NOW), false);
  });
  t("clock skew: lastNudgeAt in the FUTURE → no nudge, no crash", () => {
    assert.equal(
      shouldNudge(snap({ dueAt: ago(DAY_MS), lastNudgeAt: ahead(60_000) }), NOW),
      false,
    );
  });

  // ── recipients ───────────────────────────────────────────────────────────
  t("REVIEW nudges the AUTHOR only (owner already did their part)", () => {
    assert.deepEqual(nudgeRecipients({ status: "REVIEW", ownerId: "owner1" }, "author1"), ["author1"]);
  });
  t("ACTIVE nudges owner + author", () => {
    assert.deepEqual(nudgeRecipients({ status: "ACTIVE", ownerId: "o1" }, "a1"), ["o1", "a1"]);
  });
  t("owner == author → exactly one notification", () => {
    assert.deepEqual(nudgeRecipients({ status: "ACTIVE", ownerId: "same" }, "same"), ["same"]);
  });
  t("no owner → author only", () => {
    assert.deepEqual(nudgeRecipients({ status: "BLOCKED", ownerId: null }, "a1"), ["a1"]);
  });

  // ── reason strings ───────────────────────────────────────────────────────
  t("overdue by 1ms reads at least 기한 1일 지남", () => {
    const m = snap({ dueAt: ago(1) });
    const r = attentionReason(classifyAttention(m, NOW), m, NOW);
    assert.match(r, /기한 1일 지남/);
  });
  t("overdue + stalled join with ·", () => {
    const m = snap({ dueAt: ago(2 * DAY_MS), updatedAt: ago(5 * DAY_MS) });
    const r = attentionReason(classifyAttention(m, NOW, { stallDays: 3 }), m, NOW);
    assert.match(r, /기한 2일 지남 · 5일째 무소식/);
  });
  t("BLOCKED stalled reads 막힘 N일 방치", () => {
    const m = snap({ status: "BLOCKED" as const, updatedAt: ago(4 * DAY_MS) });
    const r = attentionReason(classifyAttention(m, NOW), m, NOW);
    assert.match(r, /막힘 4일 방치/);
  });
  t("REVIEW neglect reads 검수 N일 대기", () => {
    const m = snap({ status: "REVIEW" as const, submittedAt: ago(3 * DAY_MS) });
    const r = attentionReason(classifyAttention(m, NOW), m, NOW);
    assert.match(r, /검수 3일 대기/);
  });

  // ── review gate transitions ──────────────────────────────────────────────
  t("member's 완료 becomes REVIEW (a claim, not a fact)", () => {
    assert.deepEqual(resolveStatusChange("DONE", { isAuthor: false, isAdmin: false }), {
      status: "REVIEW",
      needsReview: true,
    });
  });
  t("author's 완료 is DONE directly", () => {
    assert.deepEqual(resolveStatusChange("DONE", { isAuthor: true, isAdmin: false }), {
      status: "DONE",
      needsReview: false,
    });
  });
  t("admin's 완료 is DONE directly", () => {
    assert.deepEqual(resolveStatusChange("DONE", { isAuthor: false, isAdmin: true }), {
      status: "DONE",
      needsReview: false,
    });
  });
  t("author+admin both true → DONE", () => {
    assert.deepEqual(resolveStatusChange("DONE", { isAuthor: true, isAdmin: true }), {
      status: "DONE",
      needsReview: false,
    });
  });
  t("explicit REVIEW request is submit-for-review for anyone", () => {
    assert.deepEqual(resolveStatusChange("REVIEW", { isAuthor: false, isAdmin: false }), {
      status: "REVIEW",
      needsReview: true,
    });
    assert.deepEqual(resolveStatusChange("REVIEW", { isAuthor: true, isAdmin: true }), {
      status: "REVIEW",
      needsReview: true,
    });
  });
  t("other statuses pass through unchanged, never flag review", () => {
    for (const s of ["PENDING", "ACTIVE", "BLOCKED"] as const) {
      assert.deepEqual(resolveStatusChange(s, { isAuthor: false, isAdmin: false }), {
        status: s,
        needsReview: false,
      });
    }
  });
  t("canReview: author yes, admin yes, plain member no", () => {
    assert.equal(canReview({ isAuthor: true, isAdmin: false }), true);
    assert.equal(canReview({ isAuthor: false, isAdmin: true }), true);
    assert.equal(canReview({ isAuthor: false, isAdmin: false }), false);
  });

  // ── env parsing hardening ────────────────────────────────────────────────
  t("STALL_DAYS garbage/zero/negative falls back to 3; valid value honored", () => {
    const orig = process.env.STALL_DAYS;
    try {
      process.env.STALL_DAYS = "abc";
      assert.equal(stallDays(), 3);
      process.env.STALL_DAYS = "0";
      assert.equal(stallDays(), 3);
      process.env.STALL_DAYS = "-2";
      assert.equal(stallDays(), 3);
      process.env.STALL_DAYS = "5";
      assert.equal(stallDays(), 5);
      delete process.env.STALL_DAYS;
      assert.equal(stallDays(), 3);
    } finally {
      if (orig === undefined) delete process.env.STALL_DAYS;
      else process.env.STALL_DAYS = orig;
    }
  });

  // ── needsAttention composition ───────────────────────────────────────────
  t("needsAttention is the OR of all three flags", () => {
    assert.equal(needsAttention({ overdue: false, stalled: false, reviewNeglected: false }), false);
    assert.equal(needsAttention({ overdue: true, stalled: false, reviewNeglected: false }), true);
    assert.equal(needsAttention({ overdue: false, stalled: true, reviewNeglected: false }), true);
    assert.equal(needsAttention({ overdue: false, stalled: false, reviewNeglected: true }), true);
  });
}
