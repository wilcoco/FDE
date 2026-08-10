/**
 * Tests for the local-connector pure logic: payload building (metadata-only by
 * default, per-mail body opt-in), sent-mailbox picking, and that connector
 * payloads flow correctly through the same routing as the CC webhook.
 */
import assert from "node:assert/strict";
import { envelopeToIntakePayload, pickSentMailbox, formatMailRow } from "../src/lib/connector";
import { routeInboundEmail } from "../src/lib/inbound-email";

const ENV = {
  messageId: "m-1@naver.com",
  subject: "견적 요청",
  from: "김대표 <ceo@acme.com>",
  to: ["vendor@partner.co.kr"],
  date: "2026-08-10T09:00:00.000Z",
};

export async function run(t: (name: string, fn: () => void) => void) {
  t("payload: metadata-only by default (text null), inbound address appended", () => {
    const p = envelopeToIntakePayload(ENV, { inboundAddress: "acme-x7k2ab@in.flowdesk.app" });
    assert.equal(p.text, null);
    assert.ok(p.to.includes("acme-x7k2ab@in.flowdesk.app"));
    assert.ok(p.to.includes("vendor@partner.co.kr"));
    assert.equal(p.messageId, "m-1@naver.com");
    assert.equal(p.spf, null); // absent, not "fail" — local transport is trusted
  });

  t("payload: body included only on explicit per-mail opt-in", () => {
    const p = envelopeToIntakePayload(ENV, { inboundAddress: "a-b@in.flowdesk.app", body: "본문" });
    assert.equal(p.text, "본문");
  });

  t("connector payload routes as CREATE through the same pipeline", () => {
    const p = envelopeToIntakePayload(ENV, { inboundAddress: "acme-x7k2ab@in.flowdesk.app" });
    const d = routeInboundEmail(p, { tenantExists: true, senderIsMember: true, known: new Set() });
    assert.deepEqual(d, { action: "create", slug: "acme" });
  });

  t("connector reply payload routes as REPLY when thread is tracked", () => {
    const p = envelopeToIntakePayload(
      { ...ENV, messageId: "r-1@partner", inReplyTo: "<m-1@naver.com>", from: "vendor@partner.co.kr" },
      { inboundAddress: "acme-x7k2ab@in.flowdesk.app" },
    );
    const d = routeInboundEmail(p, { tenantExists: true, senderIsMember: false, known: new Set(["m-1@naver.com"]) });
    assert.equal(d.action, "reply");
  });

  t("pickSentMailbox: special-use wins, then common names incl. Korean", () => {
    assert.equal(pickSentMailbox([{ path: "X" }, { path: "Y", specialUse: "\\Sent" }]), "Y");
    assert.equal(pickSentMailbox([{ path: "INBOX" }, { path: "보낸편지함" }]), "보낸편지함");
    assert.equal(pickSentMailbox([{ path: "[Gmail]/Sent Mail" }]), "[Gmail]/Sent Mail");
    assert.equal(pickSentMailbox([{ path: "INBOX" }]), null);
  });

  t("formatMailRow: readable one-liner, tolerant of missing fields", () => {
    const row = formatMailRow(3, ENV);
    assert.ok(row.includes("[ 3]"));
    assert.ok(row.includes("견적 요청"));
    assert.ok(formatMailRow(0, { messageId: "x" }).includes("(제목 없음)"));
  });
}
