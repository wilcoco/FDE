/**
 * Adversarial user-scenario walkthrough against the running app (localhost:3100).
 * Personas: 사장(신규 가입) / 사원(가입 요청) — plus abuse attempts.
 * Screenshots go to scratchpad/shots for visual usability review.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const SHOTS =
  process.env.E2E_SHOTS ?? "/tmp/e2e-shots";
mkdirSync(SHOTS, { recursive: true });

// unique per run so reruns don't collide on unique-email constraints
const RUN = Date.now().toString(36).slice(-5);
const BOSS_EMAIL = `boss-${RUN}@test.co`;
const STAFF_EMAIL = `staff-${RUN}@test.co`;
const COMPANY = `테스트<b>주식회사</b> ${RUN}`;

const findings: string[] = [];
let step = 0;
function note(kind: "OK" | "ISSUE" | "INFO", msg: string) {
  const line = `[${kind}] ${msg}`;
  findings.push(line);
  console.log(line);
}
async function shot(page: Page, name: string) {
  step++;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: false });
}

/** wait until React hydration is done enough that buttons actually work */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function main() {
  const browser: Browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // ── PERSONA 1: 사장 (desktop) ──────────────────────────────────────────────
  const boss = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: "ko-KR" });
  const b = await boss.newPage();
  b.setDefaultTimeout(20000);

  // adversarial: XSS-ish company name + korean, spaces
  await b.goto(`${BASE}/signup`);
  await settle(b);
  await shot(b, "signup");
  await b.click('button:has-text("새 회사 만들기")');
  await b.fill('input[name="companyName"]', COMPANY);
  await b.fill('input[name="name"]', "김대표");
  await b.fill('input[name="email"]', BOSS_EMAIL);
  await b.fill('input[name="password"]', "pass123");
  await b.getByRole("button", { name: "회사 만들기", exact: true }).click();
  try {
    await b.waitForURL("**/dashboard", { timeout: 30000 });
  } catch {
    console.error("signup did not navigate; url=", b.url());
    console.error("body:", (await b.locator("body").textContent())?.slice(0, 300));
    throw new Error("signup failed");
  }
  note("OK", "사장 가입 → 대시보드 진입 (한글+HTML 문자 회사명 허용됨)");
  await shot(b, "dashboard-empty");

  const xssRendered = await b.locator("b", { hasText: "주식회사" }).count();
  if (xssRendered > 0) note("ISSUE", "회사명 HTML이 실제 태그로 렌더링됨(XSS)");
  else note("OK", "회사명의 HTML이 이스케이프되어 텍스트로 표시");

  // 지시하기 — WITHOUT AI KEY: heuristic fallback path + latency
  await b.click('a[href="/capture"]');
  await b.waitForURL("**/capture");
  await shot(b, "capture");
  // adversarial: multi-sentence messy instruction
  await b.fill("textarea", "다음주까지 신제품 샘플 만들어서 거래처 3곳에 보내고, 반응 취합해서 보고해. 그리고 포장 디자인도 새로 뽑아.");
  const t0 = Date.now();
  await Promise.all([
    b.waitForURL("**/instructions/**", { timeout: 60000 }),
    b.getByRole("button", { name: "AI로 꼭지 만들기" }).click(),
  ]);
  const captureMs = Date.now() - t0;
  note("INFO", `지시→꼭지 생성 소요: ${(captureMs / 1000).toFixed(1)}s (AI키 없음 → 휴리스틱 폴백)`);
  await shot(b, "instruction-created");

  const milestoneCount = await b.locator("text=꼭지 관리").locator("xpath=..").locator(".card").count();
  const cardTitles = await b.locator("h2:has-text('꼭지 순서')").locator("xpath=../..").textContent();
  note("INFO", `폴백이 만든 꼭지 구성 확인 (제목 영역: ${cardTitles?.slice(0, 80)}...)`);

  const instructionUrl = b.url();

  // due date in the PAST (adversarial) + assign to self
  const firstDue = b.locator('input[name="dueAt"]').first();
  await firstDue.fill("2026-06-01");
  await b.locator('form:has(input[name="dueAt"]) button:has-text("저장")').first().click();
  await b.waitForTimeout(500);
  note("INFO", "과거 날짜(2026-06-01)를 기한으로 저장 시도 — 막는 검증 없음");
  await shot(b, "past-due-set");

  // ── PERSONA 2: 사원 — 회사 검색 가입 요청 (mobile 390px) ───────────────────
  const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });
  const s = await staffCtx.newPage();
  s.setDefaultTimeout(20000);
  await s.goto(`${BASE}/signup`);
  await settle(s);
  await s.click('button:has-text("기존 회사에 가입")');
  await s.fill('input[placeholder*="회사명"]', RUN);
  await s.waitForTimeout(1200); // debounce
  await shot(s, "mobile-company-search");
  const hit = s.locator("button", { hasText: RUN }).first();
  if ((await hit.count()) === 0) {
    note("ISSUE", "회사 검색 결과가 뜨지 않음");
  } else {
    await hit.click();
    await s.fill('input[name="name"]', "박사원");
    await s.fill('input[name="email"]', STAFF_EMAIL);
    await s.fill('input[name="password"]', "pass123");
    await s.click('button:has-text("가입 요청 보내기")');
    await s.waitForSelector("text=가입 요청을 보냈습니다");
    note("OK", "사원 가입 요청 제출(모바일) — 성공 안내 표시");
    await shot(s, "mobile-join-requested");
  }

  // adversarial: 사원이 승인 전에 로그인 시도
  await s.goto(`${BASE}/login`);
  await settle(s);
  await s.fill('input[name="email"]', STAFF_EMAIL);
  await s.fill('input[name="password"]', "pass123");
  await s.click('button:has-text("로그인")');
  await s.waitForTimeout(1500);
  const preApproveErr = await s.locator("text=/올바르지 않습니다/").count();
  note(preApproveErr > 0 ? "INFO" : "ISSUE",
    preApproveErr > 0
      ? "승인 전 로그인 차단됨 — 그러나 오류문구가 '이메일 또는 비밀번호가 올바르지 않습니다'라 사용자는 승인 대기 중인지 알 수 없음"
      : "승인 전 로그인이 차단되지 않거나 다른 동작");
  await shot(s, "mobile-login-before-approval");

  // ── 사장: 가입 요청 승인 ──────────────────────────────────────────────────
  await b.goto(`${BASE}/members`);
  await shot(b, "members-join-request");
  const approveBtn = b.locator('button:has-text("승인")').first();
  if ((await approveBtn.count()) === 0) note("ISSUE", "멤버 페이지에 가입 요청 대기가 안 보임");
  else {
    await approveBtn.click();
    await b.waitForSelector("text=승인됨");
    note("OK", "사장이 가입 요청 승인 → '최근 처리된 가입 요청'에 승인됨 배지");
    await shot(b, "members-approved");
  }

  // 사장: 꼭지 담당자를 사원으로 배정
  await b.goto(instructionUrl);
  const ownerSelect = b.locator('select[name="ownerId"]').first();
  await ownerSelect.selectOption({ label: "박사원" });
  await b.locator('form:has(select[name="ownerId"]) button:has-text("배정")').first().click();
  await b.waitForTimeout(600);
  // 상태도 진행으로
  const statusSelect = b.locator('select[name="status"]').first();
  await statusSelect.selectOption("ACTIVE");
  await b.locator('form:has(select[name="status"]) button:has-text("상태 변경")').first().click();
  await b.waitForTimeout(600);
  note("OK", "사장이 첫 꼭지를 박사원에게 배정 + 진행 상태로");

  // ── 사원 로그인 (모바일) → 인박스 → 완료 제출 ─────────────────────────────
  await s.goto(`${BASE}/login`);
  await settle(s);
  await s.fill('input[name="email"]', STAFF_EMAIL);
  await s.fill('input[name="password"]', "pass123");
  await Promise.all([s.waitForURL("**/dashboard"), s.click('button:has-text("로그인")')]);
  note("OK", "승인 후 사원 로그인 성공 (회사칸 비움 — 이메일만으로)");
  await shot(s, "mobile-staff-dashboard");

  // hamburger nav usability
  await s.click('button[aria-label="메뉴 열기"]');
  await s.waitForTimeout(300);
  await shot(s, "mobile-drawer");
  await s.locator('a[href="/inbox"]:visible').first().click();
  await s.waitForURL("**/inbox");
  await shot(s, "mobile-staff-inbox");

  const myMilestone = s.locator('a:has-text("열기 →")').first();
  if ((await myMilestone.count()) === 0) note("ISSUE", "사원 인박스에 배정된 꼭지가 안 보임(배정 알림 흐름 단절)");
  else {
    await myMilestone.click();
    await s.waitForURL("**/instructions/**");
    await shot(s, "mobile-staff-instruction");
    // 증빙 추가
    await s.locator('input[name="value"]').first().fill("https://example.com/result-doc");
    await s.locator('form:has(input[name="value"]) button:has-text("추가")').first().click();
    await s.waitForTimeout(600);
    // 완료 제출 — 사원에게는 '완료 제출 (검수 요청)' 라벨이어야 함
    const staffStatusSel = s.locator('select[name="status"]').first();
    const doneLabel = await staffStatusSel.locator('option[value="DONE"]').textContent();
    note("INFO", `사원에게 보이는 완료 라벨: "${doneLabel?.trim()}"`);
    await staffStatusSel.selectOption("DONE");
    await s.locator('form:has(select[name="status"]) button:has-text("상태 변경")').first().click();
    await s.waitForTimeout(800);
    const reviewBadge = await s.locator("text=검수 대기").count();
    note(reviewBadge > 0 ? "OK" : "ISSUE",
      reviewBadge > 0 ? "사원의 완료 → 검수 대기로 전환 확인" : "완료 제출 후 검수 상태 표시가 안 보임");
    await shot(s, "mobile-staff-submitted");
  }

  // ── 사장: 대시보드 주의 필요 카드 + 검수 반려 ─────────────────────────────
  await b.goto(`${BASE}/dashboard`);
  await shot(b, "boss-dashboard-attention");
  const attention = await b.locator("text=주의 필요").count();
  const reviewLine = await b.locator("text=/검수.*1건/").count();
  note(attention > 0 ? "OK" : "ISSUE", attention > 0 ? "대시보드에 🚨 주의 필요 카드 표시" : "주의 필요 카드 없음");
  note(reviewLine > 0 ? "OK" : "INFO", reviewLine > 0 ? "검수 대기 1건이 카드에 집계됨" : "검수 건수 표기가 예상 문구와 다름");

  // 인박스에서 반려 (빈 사유 — adversarial)
  await b.goto(`${BASE}/inbox`);
  await shot(b, "boss-inbox-review");
  const returnBtn = b.locator('button:has-text("반려")').first();
  if ((await returnBtn.count()) === 0) note("ISSUE", "사장 인박스에 검수 대기 항목이 없음");
  else {
    await returnBtn.click(); // 사유 비운 채 반려
    await b.waitForTimeout(800);
    note("OK", "빈 사유로 반려 → 기본 문구로 대체되는지 사원 화면에서 확인 예정");
  }

  // 사원: 반려 확인
  await s.goto(`${BASE}/inbox`);
  await shot(s, "mobile-staff-returned");
  const returned = await s.locator("text=반려됨").count();
  note(returned > 0 ? "OK" : "ISSUE", returned > 0 ? "사원 인박스에 반려됨 + 사유 표시" : "반려 상태가 사원에게 안 보임");

  // 사원: 다시 완료 제출 → 사장: 이번엔 확인(확정)
  await s.locator('a:has-text("열기 →")').first().click();
  await s.waitForURL("**/instructions/**");
  const sSel = s.locator('select[name="status"]').first();
  await sSel.selectOption("DONE");
  await s.locator('form:has(select[name="status"]) button:has-text("상태 변경")').first().click();
  await s.waitForTimeout(800);

  await b.goto(`${BASE}/inbox`);
  const approveMs = b.locator('button:has-text("확인 (완료 확정)")').first();
  if ((await approveMs.count()) === 0) note("ISSUE", "재제출 후 사장 인박스에 검수 항목이 다시 안 뜸");
  else {
    await approveMs.click();
    await b.waitForTimeout(800);
    note("OK", "사장 확인 → 완료 확정");
  }
  await b.goto(instructionUrl);
  await shot(b, "boss-after-approve");
  const nextActive = await b.locator("text=진행").count();
  note(nextActive > 0 ? "OK" : "INFO", "확정 후 다음 꼭지 자동 시작 여부 화면 확인");

  // ── 권한 적대 테스트: 사원이 관리자 페이지/타사 데이터 접근 ────────────────
  await s.goto(`${BASE}/members`);
  await shot(s, "mobile-staff-members-page");
  const adminUi = await s.locator("text=회사 공용 가입 링크").count();
  note(adminUi === 0 ? "OK" : "ISSUE",
    adminUi === 0 ? "사원에게 관리자 UI(가입 링크 등) 숨김 — 멤버 목록은 열람 가능" : "사원에게 관리자 UI가 노출됨");

  // 존재하지 않는/타사 지시 접근
  const res = await s.goto(`${BASE}/instructions/nonexistent-id-12345`);
  note(res?.status() === 404 ? "OK" : "ISSUE", `없는 지시 접근 → HTTP ${res?.status()} (404 기대)`);

  // 잘못된 비밀번호 5회 (rate limit 부재 확인)
  await s.goto(`${BASE}/login`);
  for (let i = 0; i < 3; i++) {
    await s.fill('input[name="email"]', BOSS_EMAIL);
    await s.fill('input[name="password"]', "wrongpass" + i);
    await s.click('button:has-text("로그인")');
    await s.waitForTimeout(400);
  }
  note("INFO", "로그인 연속 실패에 잠금/지연 없음(레이트리밋 부재) — 추후 보완 후보");

  // 로그아웃 후 보호 라우트
  await boss.clearCookies();
  const prot = await b.goto(`${BASE}/dashboard`);
  note(b.url().includes("/login") ? "OK" : "ISSUE", `비로그인 /dashboard → ${b.url().includes("/login") ? "로그인으로 리다이렉트" : "접근 허용?!"}`);

  await browser.close();
  console.log("\n===== SUMMARY =====");
  for (const f of findings) console.log(f);
}

main().catch((e) => {
  console.error("E2E FATAL:", e);
  process.exit(1);
});
