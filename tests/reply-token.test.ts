// 직답 토큰 수명 규칙 + Gmail 스코프 가드 — 순수 로직 검증.
import assert from "node:assert/strict";
import { replyTokenExpired, REPLY_TOKEN_TTL_DAYS } from "../src/lib/reply-token";
import { GMAIL_SCOPES } from "../src/lib/gmail";

type T = (name: string, fn: () => void | Promise<void>) => Promise<void>;

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-12T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

export async function run(t: T) {
  await t("fresh ACTIVE instruction → token alive", () => {
    assert.equal(replyTokenExpired({ status: "ACTIVE", createdAt: daysAgo(1) }, now), false);
  });

  await t("ACTIVE but just inside the TTL → still alive", () => {
    assert.equal(replyTokenExpired({ status: "ACTIVE", createdAt: daysAgo(REPLY_TOKEN_TTL_DAYS) }, now), false);
  });

  await t("ACTIVE past the TTL → expired (leaked links don't live forever)", () => {
    assert.equal(replyTokenExpired({ status: "ACTIVE", createdAt: daysAgo(REPLY_TOKEN_TTL_DAYS + 1) }, now), true);
  });

  await t("ARCHIVED closes the token immediately, even when fresh", () => {
    assert.equal(replyTokenExpired({ status: "ARCHIVED", createdAt: daysAgo(0) }, now), true);
  });

  // gmail.metadata (and every other mailbox-reading scope) is on Google's
  // RESTRICTED list → annual CASA security assessment. Send-only keeps us at
  // "sensitive" (verification only). This test is the tripwire against a
  // well-meaning future scope addition quietly re-triggering the audit.
  await t("GMAIL_SCOPES stays send-only — no restricted scope may creep in", () => {
    const scopes = GMAIL_SCOPES.split(" ");
    const restricted = [
      "https://mail.google.com/",
      ...["readonly", "metadata", "modify", "compose", "insert", "settings.basic", "settings.sharing"].map(
        (s) => `https://www.googleapis.com/auth/gmail.${s}`,
      ),
    ];
    for (const r of restricted) assert.ok(!scopes.includes(r), `restricted scope present: ${r}`);
    assert.deepEqual(scopes, ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]);
  });
}
