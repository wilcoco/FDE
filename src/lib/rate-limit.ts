// In-memory fixed-window rate limiter for auth-sensitive actions.
// Suited to the current single-instance Node deployment (Railway): buckets
// reset on redeploy and are per-instance — acceptable for brute-force/spam
// protection at this scale. Swap for a Redis-backed store when scaling out.

import { headers } from "next/headers";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

export interface LimitResult {
  ok: boolean;
  /** seconds until the window resets (0 when ok) */
  retryAfterSec: number;
}

function sweep(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
  // pathological flood: shed everything rather than grow unbounded
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/** Count an attempt. Blocks once `limit` attempts land inside the window. */
export function consume(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): LimitResult {
  sweep(now);
  const k = `${scope}:${key}`;
  let b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(k, b);
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count++;
  return { ok: true, retryAfterSec: 0 };
}

/** Check without counting — use before doing work; count failures separately. */
export function peek(scope: string, key: string, limit: number, now = Date.now()): LimitResult {
  const b = buckets.get(`${scope}:${key}`);
  if (!b || b.resetAt <= now || b.count < limit) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

/** Forget a key (e.g. successful login clears its failure count). */
export function clear(scope: string, key: string): void {
  buckets.delete(`${scope}:${key}`);
}

/** Test hook. */
export function _resetAll(): void {
  buckets.clear();
}

/** Best-effort client IP (Railway/proxies set x-forwarded-for). */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return h.get("x-real-ip") ?? "local";
  } catch {
    return "local";
  }
}

export function retryMinutes(r: LimitResult): number {
  return Math.max(1, Math.ceil(r.retryAfterSec / 60));
}
