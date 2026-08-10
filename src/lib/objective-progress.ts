// Pure logic: link the strategy world (OKR/KR) to the execution world
// (instructions → milestones), and surface the say-do gap between them.
// No IO — fully unit-testable.

export interface MilestoneStat {
  status: string; // PENDING | ACTIVE | BLOCKED | REVIEW | DONE
}

/**
 * Execution progress for an objective = share of its linked instructions'
 * milestones that are DONE. This is the "do" — what the org actually finished,
 * derived from real work, never hand-entered.
 */
export function executionProgress(milestones: MilestoneStat[]): {
  total: number;
  done: number;
  active: number;
  review: number;
  blocked: number;
  pct: number; // 0..100, DONE / total
} {
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "DONE").length;
  const active = milestones.filter((m) => m.status === "ACTIVE").length;
  const review = milestones.filter((m) => m.status === "REVIEW").length;
  const blocked = milestones.filter((m) => m.status === "BLOCKED").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, active, review, blocked, pct };
}

/**
 * Claimed progress for an objective = average of its KRs' currentValue/target.
 * This is the "say" — what people report the numbers to be.
 */
export function claimedProgress(
  krs: { currentValue: number; targetValue: number }[],
): { pct: number; hasKrs: boolean } {
  if (krs.length === 0) return { pct: 0, hasKrs: false };
  const each = krs.map((kr) =>
    kr.targetValue > 0 ? Math.min(100, (kr.currentValue / kr.targetValue) * 100) : 0,
  );
  const pct = Math.round(each.reduce((a, b) => a + b, 0) / each.length);
  return { pct, hasKrs: true };
}

export type GapSeverity = "none" | "watch" | "alert";

/**
 * The say-do gap at the strategy level: claimed KR progress minus actual
 * execution progress. Positive = claiming more than executed (the dangerous
 * direction — "we say we're at 70% but only 30% is actually done"). Negative =
 * quietly ahead of the numbers. Only meaningful when both sides have signal.
 */
export function sayDoGap(input: {
  claimedPct: number;
  hasKrs: boolean;
  executionTotal: number;
  executionPct: number;
}): { gap: number | null; severity: GapSeverity; direction: "over" | "under" | "even" } {
  const { claimedPct, hasKrs, executionTotal, executionPct } = input;
  // no gap to speak of unless there is both a claim and executable work
  if (!hasKrs || executionTotal === 0) {
    return { gap: null, severity: "none", direction: "even" };
  }
  const gap = claimedPct - executionPct;
  const mag = Math.abs(gap);
  const severity: GapSeverity = mag >= 40 ? "alert" : mag >= 20 ? "watch" : "none";
  const direction = gap > 5 ? "over" : gap < -5 ? "under" : "even";
  return { gap, severity, direction };
}
