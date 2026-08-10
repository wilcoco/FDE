/**
 * Tests for strategy↔execution linkage: execution progress from milestones,
 * claimed progress from KRs, and the say-do gap between them.
 */
import assert from "node:assert/strict";
import { executionProgress, claimedProgress, sayDoGap } from "../src/lib/objective-progress";

const ms = (...statuses: string[]) => statuses.map((status) => ({ status }));

export async function run(t: (name: string, fn: () => void) => void) {
  t("execution progress: DONE share of all milestones", () => {
    const e = executionProgress(ms("DONE", "DONE", "ACTIVE", "PENDING"));
    assert.equal(e.total, 4);
    assert.equal(e.done, 2);
    assert.equal(e.active, 1);
    assert.equal(e.pct, 50);
  });

  t("execution: empty → 0%, not NaN", () => {
    const e = executionProgress([]);
    assert.equal(e.total, 0);
    assert.equal(e.pct, 0);
  });

  t("execution: counts review and blocked separately", () => {
    const e = executionProgress(ms("REVIEW", "BLOCKED", "DONE"));
    assert.equal(e.review, 1);
    assert.equal(e.blocked, 1);
    assert.equal(e.done, 1);
    assert.equal(e.pct, 33); // 1/3 rounded
  });

  t("claimed progress: averages KRs, caps each at 100", () => {
    const c = claimedProgress([
      { currentValue: 5, targetValue: 10 },   // 50
      { currentValue: 30, targetValue: 10 },  // capped 100
    ]);
    assert.equal(c.hasKrs, true);
    assert.equal(c.pct, 75); // (50 + 100) / 2
  });

  t("claimed: no KRs → hasKrs false, pct 0", () => {
    const c = claimedProgress([]);
    assert.equal(c.hasKrs, false);
    assert.equal(c.pct, 0);
  });

  t("claimed: zero target doesn't divide by zero", () => {
    const c = claimedProgress([{ currentValue: 5, targetValue: 0 }]);
    assert.equal(c.pct, 0);
  });

  t("gap: null when no KRs (nothing claimed to compare)", () => {
    const g = sayDoGap({ claimedPct: 0, hasKrs: false, executionTotal: 4, executionPct: 50 });
    assert.equal(g.gap, null);
    assert.equal(g.severity, "none");
  });

  t("gap: null when no executable work (nothing done to compare)", () => {
    const g = sayDoGap({ claimedPct: 70, hasKrs: true, executionTotal: 0, executionPct: 0 });
    assert.equal(g.gap, null);
  });

  t("gap: claiming ahead of execution is the ALERT direction", () => {
    // "we report 80% but only 20% of the work is done"
    const g = sayDoGap({ claimedPct: 80, hasKrs: true, executionTotal: 5, executionPct: 20 });
    assert.equal(g.gap, 60);
    assert.equal(g.direction, "over");
    assert.equal(g.severity, "alert"); // >= 40
  });

  t("gap: execution ahead of claim is 'under' (quietly ahead)", () => {
    const g = sayDoGap({ claimedPct: 10, hasKrs: true, executionTotal: 5, executionPct: 45 });
    assert.equal(g.gap, -35);
    assert.equal(g.direction, "under");
    assert.equal(g.severity, "watch"); // 20..39
  });

  t("gap: small difference is 'even' / no severity", () => {
    const g = sayDoGap({ claimedPct: 52, hasKrs: true, executionTotal: 5, executionPct: 50 });
    assert.equal(g.gap, 2);
    assert.equal(g.direction, "even");
    assert.equal(g.severity, "none");
  });

  t("gap severity boundaries: 20 = watch, 40 = alert", () => {
    assert.equal(sayDoGap({ claimedPct: 20, hasKrs: true, executionTotal: 1, executionPct: 0 }).severity, "watch");
    assert.equal(sayDoGap({ claimedPct: 40, hasKrs: true, executionTotal: 1, executionPct: 0 }).severity, "alert");
    assert.equal(sayDoGap({ claimedPct: 19, hasKrs: true, executionTotal: 1, executionPct: 0 }).severity, "none");
  });
}
