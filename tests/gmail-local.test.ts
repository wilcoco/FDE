// 브라우저-로컬 Gmail 경로의 순수 로직 검증 — 파싱·본문 추출·답장 매칭.
import assert from "node:assert/strict";
import {
  headerOf, decodeBody, extractPlainText, toEnvelope, matchReplies,
  type GmailMessage, type GmailPayload,
} from "../src/lib/gmail-local";

type T = (name: string, fn: () => void | Promise<void>) => Promise<void>;

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function msg(headers: Record<string, string>, extra?: Partial<GmailMessage>): GmailMessage {
  return {
    id: "m1",
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
    ...extra,
  };
}

export async function run(t: T) {
  await t("headerOf is case-insensitive", () => {
    const m = msg({ "MESSAGE-ID": "<x@y>", subject: "hi" });
    assert.equal(headerOf(m, "Message-ID"), "<x@y>");
    assert.equal(headerOf(m, "Subject"), "hi");
    assert.equal(headerOf(m, "Nope"), "");
  });

  await t("decodeBody: base64url 한글 round-trip", () => {
    assert.equal(decodeBody(b64url("견적서 보내주세요 — 급함")), "견적서 보내주세요 — 급함");
  });

  await t("extractPlainText finds text/plain inside multipart/alternative", () => {
    const payload: GmailPayload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<b>hi</b>") } },
        { mimeType: "text/plain; charset=utf-8", body: { data: b64url("본문입니다") } },
      ],
    };
    assert.equal(extractPlainText(payload), "본문입니다");
  });

  await t("extractPlainText: nested multipart/mixed → alternative → plain", () => {
    const payload: GmailPayload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64url("깊은 곳") } }],
        },
        { mimeType: "application/pdf", body: { data: b64url("PDFPDF") } },
      ],
    };
    assert.equal(extractPlainText(payload), "깊은 곳");
  });

  await t("extractPlainText: single-part text/html fallback, non-text은 빈 문자열", () => {
    assert.equal(extractPlainText({ mimeType: "text/html", body: { data: b64url("<p>only html</p>") } }), "<p>only html</p>");
    assert.equal(extractPlainText({ mimeType: "application/pdf", body: { data: b64url("x") } }), "");
    assert.equal(extractPlainText(undefined), "");
  });

  await t("toEnvelope: brackets stripped, To+Cc merged, refs extracted", () => {
    const env = toEnvelope(
      msg(
        {
          "Message-ID": "<say-1@gmail.com>",
          Subject: "견적 요청",
          From: "김대표 <ceo@icams.co.kr>",
          To: "a@x.com, b@y.com",
          Cc: "c@z.com",
          "In-Reply-To": "<parent@gmail.com>",
        },
        { internalDate: "1755000000000" },
      ),
    );
    assert.equal(env.messageId, "say-1@gmail.com");
    assert.deepEqual(env.to, ["a@x.com", "b@y.com", "c@z.com"]);
    assert.ok(env.refs.includes("parent@gmail.com"));
    assert.ok(env.date?.startsWith("2025") || env.date?.startsWith("2026"));
  });

  await t("toEnvelope: Message-ID 없는 메일은 gmail-{id}로 안정화", () => {
    assert.equal(toEnvelope(msg({ Subject: "x" })).messageId, "gmail-m1");
  });

  await t("matchReplies: 대기 중인 SAY에만 매칭, 답장 도착한 건 제외, 1지시 1카드", () => {
    const tracked = [
      { msgId: "say-1@g", instructionId: "i1", replied: false },
      { msgId: "say-2@g", instructionId: "i2", replied: true }, // already replied — skip
    ];
    const inbox = [
      toEnvelope(msg({ "Message-ID": "<r1@x>", "In-Reply-To": "<say-1@g>", From: "a@x.com" })),
      toEnvelope(msg({ "Message-ID": "<r2@x>", References: "<say-1@g>", From: "b@x.com" })), // same SAY — dedup
      toEnvelope(msg({ "Message-ID": "<r3@x>", "In-Reply-To": "<say-2@g>", From: "c@x.com" })), // replied SAY
      toEnvelope(msg({ "Message-ID": "<r4@x>", Subject: "광고" })), // no refs
    ];
    const out = matchReplies(inbox, tracked);
    assert.equal(out.length, 1);
    assert.equal(out[0].instructionId, "i1");
    assert.equal(out[0].env.messageId, "r1@x");
  });
}
