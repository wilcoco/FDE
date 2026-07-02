/**
 * Adversarial tests for notification preferences: malformed stored prefs,
 * unknown types, partial objects, fail-open guarantees, round-trips.
 */
import assert from "node:assert/strict";
import { shouldNotify, effectivePrefs, categoryOf, CATEGORIES } from "../src/lib/notify-prefs";

export async function run(t: (name: string, fn: () => void) => void) {
  t("defaults: everything on except activity email", () => {
    assert.equal(shouldNotify({}, "MILESTONE_ASSIGNED", "inapp"), true);
    assert.equal(shouldNotify({}, "MILESTONE_ASSIGNED", "email"), true);
    assert.equal(shouldNotify({}, "PROOF_ADDED", "inapp"), true);
    assert.equal(shouldNotify({}, "PROOF_ADDED", "email"), false); // 소음 방지 기본값
  });

  t("disabling in-app leaves email untouched (and vice versa)", () => {
    const prefs = { review: { inapp: false, email: true } };
    assert.equal(shouldNotify(prefs, "MILESTONE_REVIEW", "inapp"), false);
    assert.equal(shouldNotify(prefs, "MILESTONE_REVIEW", "email"), true);
  });

  t("unknown notification type ALWAYS delivers (fail open)", () => {
    assert.equal(shouldNotify({}, "SOME_FUTURE_TYPE", "inapp"), true);
    assert.equal(shouldNotify({ assign: { inapp: false, email: false } }, "SOME_FUTURE_TYPE", "email"), true);
  });

  t("malformed prefs fall back to defaults, never crash", () => {
    for (const bad of [null, undefined, "junk", 42, [], { assign: "yes" }, { assign: 1 }, { assign: [] }]) {
      assert.equal(shouldNotify(bad, "MILESTONE_ASSIGNED", "inapp"), true, JSON.stringify(bad));
      assert.equal(shouldNotify(bad, "PROOF_ADDED", "email"), false, JSON.stringify(bad));
    }
  });

  t("partial channel object: missing channel uses that channel's default", () => {
    const prefs = { activity: { inapp: false } }; // email 미지정
    assert.equal(shouldNotify(prefs, "PROOF_ADDED", "inapp"), false);
    assert.equal(shouldNotify(prefs, "PROOF_ADDED", "email"), false); // default
    const prefs2 = { activity: { email: true } };
    assert.equal(shouldNotify(prefs2, "PROOF_ADDED", "inapp"), true); // default
    assert.equal(shouldNotify(prefs2, "PROOF_ADDED", "email"), true);
  });

  t("non-boolean channel values are ignored (default wins)", () => {
    const prefs = { nudge: { inapp: "false", email: 0 } };
    assert.equal(shouldNotify(prefs, "MILESTONE_NUDGE", "inapp"), true);
    assert.equal(shouldNotify(prefs, "MILESTONE_NUDGE", "email"), true);
  });

  t("every declared type maps to a category; approval/member routed correctly", () => {
    for (const type of [
      "MILESTONE_ASSIGNED", "TASK_ASSIGNED", "TASK", "MILESTONE_REVIEW",
      "MILESTONE_APPROVED", "MILESTONE_RETURNED", "DIRECTIVE", "MILESTONE_NUDGE",
      "PROOF_ADDED", "APPROVAL_REQUEST", "APPROVAL_APPROVED", "APPROVAL_REJECTED",
      "JOIN_REQUEST", "JOIN_APPROVED",
    ]) {
      assert.ok(categoryOf(type), type);
    }
    assert.equal(categoryOf("APPROVAL_REJECTED")!.key, "approval");
    assert.equal(categoryOf("JOIN_REQUEST")!.key, "member");
  });

  t("effectivePrefs round-trips saved settings for every category", () => {
    const all: Record<string, { inapp: boolean; email: boolean }> = {};
    for (const c of CATEGORIES) all[c.key] = { inapp: false, email: false };
    const eff = effectivePrefs(all);
    for (const c of CATEGORIES) {
      assert.deepEqual(eff[c.key], { inapp: false, email: false }, c.key);
    }
    const effDefault = effectivePrefs({});
    for (const c of CATEGORIES) assert.deepEqual(effDefault[c.key], c.defaults, c.key);
  });
}
