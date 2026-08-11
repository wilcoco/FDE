/**
 * Tests for raw-mail parsing: RFC2047 한글 제목 (UTF-8/EUC-KR × B/Q), header
 * unfolding, envelope extraction, MIME text-body extraction.
 */
import assert from "node:assert/strict";
import { decodeWords, parseHeaders, headersToEnvelope, extractTextBody } from "../src/lib/mail-headers";

export async function run(t: (name: string, fn: () => void) => void) {
  t("decodeWords: UTF-8 base64 한글 제목", () => {
    const enc = `=?UTF-8?B?${Buffer.from("견적 부탁드립니다").toString("base64")}?=`;
    assert.equal(decodeWords(enc), "견적 부탁드립니다");
  });

  t("decodeWords: EUC-KR base64 (국산 메일서버 단골)", () => {
    // "안녕" in EUC-KR bytes: b0 fa b3 e7? — build via TextEncoder we can't (no euc-kr encode).
    // Known-good fixture: "테스트" in EUC-KR = C5 D7 BD BA C6 AE
    const euckr = Buffer.from([0xc5, 0xd7, 0xbd, 0xba, 0xc6, 0xae]);
    const enc = `=?EUC-KR?B?${euckr.toString("base64")}?=`;
    assert.equal(decodeWords(enc), "테스트");
  });

  t("decodeWords: ks_c_5601-1987 alias → euc-kr", () => {
    const euckr = Buffer.from([0xc5, 0xd7, 0xbd, 0xba, 0xc6, 0xae]);
    assert.equal(decodeWords(`=?ks_c_5601-1987?B?${euckr.toString("base64")}?=`), "테스트");
  });

  t("decodeWords: Q-encoding with underscores and =XX", () => {
    assert.equal(decodeWords("=?UTF-8?Q?hello_world?="), "hello world");
    assert.equal(decodeWords("=?UTF-8?Q?a=20b?="), "a b");
  });

  t("decodeWords: adjacent encoded-words join without gap; plain text untouched", () => {
    const a = `=?UTF-8?B?${Buffer.from("견적").toString("base64")}?=`;
    const b = `=?UTF-8?B?${Buffer.from(" 요청").toString("base64")}?=`;
    assert.equal(decodeWords(`${a} ${b}`), "견적 요청");
    assert.equal(decodeWords("plain subject"), "plain subject");
  });

  t("parseHeaders: unfolds continuation lines, first value wins", () => {
    const h = parseHeaders("Subject: line one\r\n continued\r\nFrom: a@b\r\nFrom: dup@x\r\n");
    assert.equal(h.get("subject"), "line one continued");
    assert.equal(h.get("from"), "a@b");
  });

  t("headersToEnvelope: full block → envelope with bare message-id", () => {
    const raw = [
      "Return-Path: <json@icams.co.kr>",
      "Message-ID: <say-1@mail.icams.co.kr>",
      "In-Reply-To: <parent@x>",
      "References: <root@x> <parent@x>",
      `Subject: =?UTF-8?B?${Buffer.from("납품 일정 회신 요청").toString("base64")}?=`,
      "From: json@icams.co.kr",
      "To: vendor@partner.co.kr, second@x.com",
      "Cc: cc1@y.com",
      "Date: Tue, 11 Aug 2026 10:00:00 +0900",
      "",
    ].join("\r\n");
    const env = headersToEnvelope(raw, "fallback");
    assert.equal(env.messageId, "say-1@mail.icams.co.kr");
    assert.equal(env.subject, "납품 일정 회신 요청");
    assert.deepEqual(env.to, ["vendor@partner.co.kr", "second@x.com", "cc1@y.com"]);
    assert.equal(env.inReplyTo, "<parent@x>");
    assert.ok(env.date?.startsWith("2026-08-11"));
  });

  t("headersToEnvelope: missing message-id falls back; garbage date → null", () => {
    const env = headersToEnvelope("Subject: x\r\nDate: not-a-date\r\n", "fb-1");
    assert.equal(env.messageId, "fb-1");
    assert.equal(env.date, null);
  });

  // extractTextBody's input is a BINARY string (bytes as latin1 — what the
  // POP3 socket layer yields), so 한글 fixtures must be byte-encoded first.
  const wire = (s: string) => Buffer.from(s, "utf8").toString("binary");

  t("extractTextBody: plain utf-8 body (binary wire string)", () => {
    const raw = wire("Content-Type: text/plain; charset=utf-8\r\n\r\n안녕하세요.\r\n견적 부탁드립니다.");
    assert.equal(extractTextBody(raw), "안녕하세요.\r\n견적 부탁드립니다.");
  });

  t("extractTextBody: base64 euc-kr body decodes", () => {
    const euckr = Buffer.from([0xc5, 0xd7, 0xbd, 0xba, 0xc6, 0xae]); // 테스트
    const raw = `Content-Type: text/plain; charset=euc-kr\r\nContent-Transfer-Encoding: base64\r\n\r\n${euckr.toString("base64")}`;
    assert.equal(extractTextBody(raw), "테스트");
  });

  t("extractTextBody: multipart picks first text/plain part", () => {
    const raw = wire([
      'Content-Type: multipart/alternative; boundary="BOUND"',
      "",
      "--BOUND",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "본문입니다",
      "--BOUND",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>html</p>",
      "--BOUND--",
      "",
    ].join("\r\n"));
    assert.equal(extractTextBody(raw), "본문입니다");
  });

  t("extractTextBody: quoted-printable soft breaks", () => {
    const raw = "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nabc=\r\ndef =41";
    assert.equal(extractTextBody(raw), "abcdef A");
  });

  t("extractTextBody: attachment-only mail returns empty, never throws", () => {
    assert.equal(extractTextBody("Content-Type: application/pdf\r\n\r\nBINARY"), "");
    assert.equal(extractTextBody("no separator at all"), "");
  });
}
