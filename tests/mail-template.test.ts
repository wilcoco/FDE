// 지시 메일 템플릿 — 일의 전후: 발송 전에 분해된 꼭지가 메일 안에 실린다.
import assert from "node:assert/strict";
import { askMailText, askMailHtml, escapeHtml } from "../src/lib/mail-template";

type T = (name: string, fn: () => void | Promise<void>) => Promise<void>;

const BASE = {
  senderName: "김대표",
  senderEmail: "ceo@icams.co.kr",
  subject: "신제품 출시 준비",
  body: "다음 달 출시 준비해주세요.",
  replyUrl: "https://app.example/r/tok-1",
};

export async function run(t: T) {
  await t("text: 꼭지 목록이 번호와 함께 실린다", () => {
    const out = askMailText({ ...BASE, tasks: ["홍보안 작성", "거래처 사전 영업", "초도 물량 확보"] });
    assert.match(out, /요청 항목:/);
    assert.match(out, /1\. 홍보안 작성/);
    assert.match(out, /3\. 초도 물량 확보/);
    assert.match(out, /https:\/\/app\.example\/r\/tok-1/);
  });

  await t("text: tasks 없거나 비면 요청 항목 블록도 없다", () => {
    assert.ok(!/요청 항목/.test(askMailText(BASE)));
    assert.ok(!/요청 항목/.test(askMailText({ ...BASE, tasks: [] })));
  });

  await t("text: 링크 막힌 환경 회신 안내가 들어 있다", () => {
    assert.match(askMailText(BASE), /이 메일에 그대로 회신/);
  });

  await t("html: 꼭지 목록 렌더 + 제목 escape", () => {
    const out = askMailHtml({ ...BASE, subject: "<b>주의</b>", tasks: ["단가 <5,000원> 확인"] });
    assert.match(out, /요청 항목/);
    assert.ok(out.includes(escapeHtml("단가 <5,000원> 확인")));
    assert.ok(!out.includes("<b>주의</b>")); // 제목이 그대로 HTML로 들어가면 안 된다
    assert.match(out, /바로 답변하기/);
  });

  await t("html: tasks 없으면 요청 항목 블록 생략", () => {
    assert.ok(!/요청 항목/.test(askMailHtml(BASE)));
  });
}
