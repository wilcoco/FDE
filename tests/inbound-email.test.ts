/**
 * Tests for email intake pure logic: address parsing, thread-ref extraction,
 * routing decisions (spoofing, membership, reply vs create), body privacy.
 */
import assert from "node:assert/strict";
import {
  inboundAddress, parseInboundAddress, normalizeEmail, extractThreadRefs,
  routeInboundEmail, selectStoredBody, stripQuotedTail, counterpartyOf, type InboundPayload,
} from "../src/lib/inbound-email";

const base = (over: Partial<InboundPayload> = {}): InboundPayload => ({
  to: ["acme-x7k2ab@in.flowdesk.app"],
  from: "김대표 <ceo@acme.com>",
  subject: "견적 받아줘",
  messageId: "msg-1@mail",
  ...over,
});

export async function run(t: (name: string, fn: () => void) => void) {
  t("address round-trip + parse from a recipient list", () => {
    const a = inboundAddress("acme", "x7k2ab");
    assert.equal(a, "acme-x7k2ab@in.flowdesk.app");
    assert.deepEqual(parseInboundAddress(["someone@x.com", `To <${a}>`]), { slug: "acme", token: "x7k2ab" });
    assert.equal(parseInboundAddress(["nobody@other.com"]), null);
  });

  t("normalizeEmail strips display name and lowercases", () => {
    assert.equal(normalizeEmail("김대표 <CEO@Acme.com>"), "ceo@acme.com");
    assert.equal(normalizeEmail("staff@acme.com"), "staff@acme.com");
  });

  t("extractThreadRefs: References newest-first, In-Reply-To included", () => {
    const refs = extractThreadRefs({ inReplyTo: "<b@m>", references: "<a@m> <b@m>" });
    assert.equal(refs[0], "b@m"); // nearest ancestor first
    assert.ok(refs.includes("a@m"));
  });

  const ctxOK = { tenantExists: true, senderIsMember: true, known: new Set<string>() };

  t("create when sender is a member and no matching thread", () => {
    assert.deepEqual(routeInboundEmail(base(), ctxOK), { action: "create", slug: "acme" });
  });

  t("reject: no inbound address in recipients", () => {
    const d = routeInboundEmail(base({ to: ["x@y.com"] }), ctxOK);
    assert.deepEqual(d, { action: "reject", reason: "no_inbound_address" });
  });

  t("reject: unknown tenant", () => {
    const d = routeInboundEmail(base(), { ...ctxOK, tenantExists: false });
    assert.equal(d.action === "reject" && d.reason, "unknown_tenant");
  });

  t("reject: sender not a member (outsider can't inject SAYs)", () => {
    const d = routeInboundEmail(base(), { ...ctxOK, senderIsMember: false });
    assert.equal(d.action === "reject" && d.reason, "sender_not_member");
  });

  t("reject: SPF/DKIM fail (anti-spoof)", () => {
    assert.equal((routeInboundEmail(base({ spf: "fail" }), ctxOK) as { reason: string }).reason, "spf_fail");
    assert.equal((routeInboundEmail(base({ dkim: "FAIL" }), ctxOK) as { reason: string }).reason, "dkim_fail");
    // pass/absent is fine
    assert.equal(routeInboundEmail(base({ spf: "pass" }), ctxOK).action, "create");
  });

  t("reply: matches a known thread id from References", () => {
    const d = routeInboundEmail(
      base({ inReplyTo: "<msg-1@mail>", references: "<msg-1@mail>" }),
      { ...ctxOK, known: new Set(["msg-1@mail"]) },
    );
    assert.deepEqual(d, { action: "reply", slug: "acme", parentMessageId: "msg-1@mail" });
  });

  t("reply from an OUTSIDER (거래처) is accepted when the thread matches", () => {
    const d = routeInboundEmail(
      base({ from: "거래처 <vendor@partner.co.kr>", inReplyTo: "<msg-1@mail>" }),
      { ...ctxOK, senderIsMember: false, known: new Set(["msg-1@mail"]) },
    );
    assert.equal(d.action, "reply"); // DO from outside the org — the common case
  });

  t("outsider still cannot CREATE a new instruction", () => {
    const d = routeInboundEmail(
      base({ from: "거래처 <vendor@partner.co.kr>" }),
      { ...ctxOK, senderIsMember: false },
    );
    assert.equal(d.action === "reject" && d.reason, "sender_not_member");
  });

  t("reply matching precedes create even with a thread present but unknown", () => {
    const d = routeInboundEmail(
      base({ references: "<unknown@mail>" }),
      { ...ctxOK, known: new Set(["other@mail"]) },
    );
    assert.equal(d.action, "create"); // referenced id not tracked → new SAY
  });

  t("counterpartyOf: recipients minus our address and the sender", () => {
    const cp = counterpartyOf(
      ["vendor@partner.co.kr", "acme-x7k2ab@in.flowdesk.app", "CEO@acme.com", "vendor@partner.co.kr"],
      "김대표 <ceo@acme.com>",
    );
    assert.equal(cp, "vendor@partner.co.kr"); // intake addr + self + dup removed
  });

  t("counterpartyOf: multiple distinct recipients joined", () => {
    const cp = counterpartyOf(["a@x.com", "b@y.com", "acme-t@in.flowdesk.app"], "me@acme.com");
    assert.equal(cp, "a@x.com, b@y.com");
  });

  t("selectStoredBody: withheld unless opted in", () => {
    assert.equal(selectStoredBody("본문 내용", false), "");
    assert.equal(selectStoredBody("본문 내용", true), "본문 내용");
  });

  t("stripQuotedTail removes quoted history and signature", () => {
    const body = "네 확인했습니다.\n\nOn 2026 Kim wrote:\n> 이전 내용\n> 더";
    assert.equal(stripQuotedTail(body), "네 확인했습니다.");
    const sig = "완료했습니다\n--\n김대표\n대표이사";
    assert.equal(stripQuotedTail(sig), "완료했습니다");
  });
}
