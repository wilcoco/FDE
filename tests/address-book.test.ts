// 브라우저-로컬 주소록 + AI 초안 폴백 — 순수 로직 검증.
import assert from "node:assert/strict";
import { mergeAddresses, topAddresses, suggestFromText, parseAddress, type AddrEntry } from "../src/lib/address-book";
import { draftAskMail } from "../src/lib/ai";

type T = (name: string, fn: () => void | Promise<void>) => Promise<void>;

export async function run(t: T) {
  await t("mergeAddresses: 정규화·자기 제외·카운트 증가", () => {
    const book = mergeAddresses([], ['"박상무" <A@x.com>', "b@y.com", "me@self.com", "not-an-email"], 1000, "ME@self.com");
    assert.deepEqual(book.map((e) => e.email).sort(), ["a@x.com", "b@y.com"]);
    const again = mergeAddresses(book, ["a@x.com"], 2000);
    const a = again.find((e) => e.email === "a@x.com")!;
    assert.equal(a.count, 2);
    assert.equal(a.lastSeen, 2000);
  });

  await t("mergeAddresses: 200개 상한 — 빈도 낮고 오래된 것부터 밀려난다", () => {
    let book: AddrEntry[] = [];
    for (let i = 0; i < 230; i++) book = mergeAddresses(book, [`u${i}@x.com`], i);
    assert.equal(book.length, 200);
    book = mergeAddresses(book, ["u5@x.com"], 999); // 없던 옛 주소가 다시 오면 재진입
    assert.ok(book.some((e) => e.email === "u5@x.com"));
  });

  await t("parseAddress: 표시 이름 분리 — 따옴표·한글·이름 없음", () => {
    assert.deepEqual(parseAddress('"김부장" <KIM@x.com>'), { name: "김부장", email: "kim@x.com" });
    assert.deepEqual(parseAddress("(주)파트너 박상무 <park@p.co.kr>"), { name: "(주)파트너 박상무", email: "park@p.co.kr" });
    assert.deepEqual(parseAddress("bare@x.com"), { name: "", email: "bare@x.com" });
  });

  await t("mergeAddresses: 이름 저장 — 최신 비어있지 않은 이름이 이긴다", () => {
    let book = mergeAddresses([], ["김부장 <kim@x.com>"], 1000);
    assert.equal(book[0].name, "김부장");
    book = mergeAddresses(book, ["kim@x.com"], 2000); // 이름 없는 재등장 — 기존 이름 유지
    assert.equal(book[0].name, "김부장");
    book = mergeAddresses(book, ["김철수 부장 <kim@x.com>"], 3000); // 새 이름이 이김
    assert.equal(book[0].name, "김철수 부장");
  });

  await t("topAddresses: 수확분(빈도순) + DB 원장 병합, 중복·자기 제거, 이름 유지", () => {
    const book: AddrEntry[] = [
      { email: "often@x.com", name: "김부장", count: 9, lastSeen: 3 },
      { email: "rare@x.com", count: 1, lastSeen: 1 },
    ];
    const out = topAddresses(book, ["ledger@y.com", "often@x.com", "me@self.com"], 8, "me@self.com");
    assert.deepEqual(out, [
      { email: "often@x.com", name: "김부장" },
      { email: "rare@x.com" },
      { email: "ledger@y.com" },
    ]);
    assert.equal(topAddresses(book, [], 1).length, 1);
  });

  await t("suggestFromText: 로컬파트(3자+)·전체 주소 매칭, 빈 텍스트는 빈 결과", () => {
    const cands = [{ email: "json@icams.co.kr" }, { email: "kim@partner.com" }, { email: "ab@x.com" }];
    assert.deepEqual(suggestFromText("json한테 견적 요청해줘", cands), ["json@icams.co.kr"]);
    assert.deepEqual(suggestFromText("kim@partner.com 으로 보내", cands), ["kim@partner.com"]);
    assert.deepEqual(suggestFromText("ab라고만 쓰면 2자라 매칭 안 됨", cands), []); // "ab"는 로컬파트 3자 미만
    assert.deepEqual(suggestFromText("   ", cands), []);
  });

  await t("suggestFromText: 음성 지시의 이름으로 매칭 — '김부장한테' → kim@x.com", () => {
    const cands = [
      { email: "kim@x.com", name: "(주)파트너 김부장" },
      { email: "lee@y.com", name: "이과장" },
    ];
    assert.deepEqual(suggestFromText("김부장한테 단가표 요청해줘", cands), ["kim@x.com"]);
    assert.deepEqual(suggestFromText("이과장 그리고 김부장 둘 다", cands).sort(), ["kim@x.com", "lee@y.com"]);
    assert.deepEqual(suggestFromText("박전무한테", cands), []); // 모르는 이름은 추천 안 함
  });

  await t("draftAskMail: API 키 없으면 휴리스틱 폴백 — 제목=첫 줄, 본문=원문", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const d = await draftAskMail("포장재 단가표 회신 부탁\n납기도 알려주세요");
      assert.equal(d.subject, "포장재 단가표 회신 부탁");
      assert.match(d.body, /납기도 알려주세요/);
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
}
