/**
 * Adversarial tests for the in-memory rate limiter: exact boundaries,
 * window expiry, peek-vs-consume semantics, key/scope isolation.
 */
import assert from "node:assert/strict";
import { consume, peek, clear, _resetAll } from "../src/lib/rate-limit";

const T0 = 1_000_000_000_000;

export async function run(t: (name: string, fn: () => void) => void) {
  t("allows exactly `limit` attempts, blocks the next", () => {
    _resetAll();
    for (let i = 0; i < 5; i++) {
      assert.equal(consume("login", "k", 5, 60_000, T0).ok, true, `attempt ${i + 1}`);
    }
    const sixth = consume("login", "k", 5, 60_000, T0);
    assert.equal(sixth.ok, false);
    assert.ok(sixth.retryAfterSec >= 1);
  });

  t("window expiry resets the bucket (1ms after resetAt)", () => {
    _resetAll();
    for (let i = 0; i < 5; i++) consume("login", "k", 5, 60_000, T0);
    assert.equal(consume("login", "k", 5, 60_000, T0 + 59_999).ok, false);
    assert.equal(consume("login", "k", 5, 60_000, T0 + 60_000).ok, true);
  });

  t("peek never consumes", () => {
    _resetAll();
    for (let i = 0; i < 100; i++) assert.equal(peek("login", "k", 5, T0).ok, true);
    for (let i = 0; i < 5; i++) consume("login", "k", 5, 60_000, T0);
    assert.equal(peek("login", "k", 5, T0).ok, false);
    assert.equal(peek("login", "k", 5, T0 + 60_001).ok, true); // expired → ok
  });

  t("clear() lifts a block immediately (successful login case)", () => {
    _resetAll();
    for (let i = 0; i < 5; i++) consume("login", "k", 5, 60_000, T0);
    assert.equal(peek("login", "k", 5, T0).ok, false);
    clear("login", "k");
    assert.equal(peek("login", "k", 5, T0).ok, true);
    assert.equal(consume("login", "k", 5, 60_000, T0).ok, true);
  });

  t("scopes and keys are isolated", () => {
    _resetAll();
    for (let i = 0; i < 5; i++) consume("login", "ip1:a@b.c", 5, 60_000, T0);
    assert.equal(peek("login", "ip1:a@b.c", 5, T0).ok, false);
    assert.equal(consume("login", "ip2:a@b.c", 5, 60_000, T0).ok, true); // other ip
    assert.equal(consume("signup", "ip1:a@b.c", 5, 60_000, T0).ok, true); // other scope
  });

  t("retryAfterSec counts down with time", () => {
    _resetAll();
    for (let i = 0; i < 3; i++) consume("s", "k", 3, 600_000, T0);
    const early = consume("s", "k", 3, 600_000, T0 + 1_000);
    const late = consume("s", "k", 3, 600_000, T0 + 590_000);
    assert.ok(!early.ok && !late.ok);
    assert.ok(early.retryAfterSec > late.retryAfterSec);
    assert.ok(late.retryAfterSec >= 1);
  });
}
