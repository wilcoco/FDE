/**
 * 대표 역할 전체 루프 E2E — 지시하기(2단계 꼭지 확정) → 메일 발송(목 SMTP 캡처)
 * → 상대방 직답(무계정, 파일 첨부) → 대시보드 답장 도착 → ✅ 수행됨 처리.
 *
 * 실행 조건:
 *  - 앱이 localhost:3100에서 실행 중 (.env의 APP_URL과 일치)
 *  - root 권한(목 POP3가 110 포트 바인딩) — 아니면 POP3_PORT=995도 불가하니 sudo로
 *  - 실존 메일 주소 사용 안 함: 모든 메일은 로컬 목 SMTP(2525)에 갇힌다
 *
 *   npx tsx tests/e2e-ceo-loop.ts
 */
import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/e2e-ceo";
mkdirSync(SHOTS, { recursive: true });

const RUN = Date.now().toString(36).slice(-5);
const BOSS_EMAIL = `boss-${RUN}@test.local`;
const PARTNER_EMAIL = `partner-${RUN}@test.local`;

let step = 0;
const findings: string[] = [];
function note(kind: "OK" | "ISSUE" | "INFO", msg: string) {
  const line = `[${kind}] ${msg}`;
  findings.push(line);
  console.log(line);
}
async function shot(page: Page, name: string) {
  step++;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png` });
}

// ── 목 메일서버: 발송된 모든 메일이 여기 갇힌다 ────────────────────────────
interface Captured { rcpt: string[]; data: string }
const captured: Captured[] = [];

function startMockSmtp(port: number): Promise<net.Server> {
  const srv = net.createServer((sock) => {
    let inData = false;
    let buf = "";
    let rcpt: string[] = [];
    let authState: 0 | 1 | 2 = 0; // 1=아이디 대기, 2=비밀번호 대기
    sock.on("error", () => {}); // 급끊김(RST)은 목 서버에선 정상 시나리오
    sock.write("220 mock-smtp ready\r\n");
    sock.on("data", (d) => {
      if (inData) {
        buf += d.toString("binary");
        const end = buf.indexOf("\r\n.\r\n");
        if (end >= 0) {
          captured.push({ rcpt: [...rcpt], data: buf.slice(0, end) });
          rcpt = [];
          buf = "";
          inData = false;
          sock.write("250 ok stored\r\n");
        }
        return;
      }
      for (const line of d.toString().split("\r\n").filter(Boolean)) {
        if (authState === 1) { authState = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authState === 2) { authState = 0; sock.write("235 authed\r\n"); continue; }
        const u = line.toUpperCase();
        if (u.startsWith("EHLO") || u.startsWith("HELO")) sock.write("250-mock\r\n250 AUTH LOGIN\r\n");
        else if (u.startsWith("AUTH LOGIN")) { authState = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (u.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
        else if (u.startsWith("RCPT TO")) { rcpt.push(line.replace(/.*<|>.*/g, "")); sock.write("250 ok\r\n"); }
        else if (u === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (u === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

function startMockPop3(port: number): Promise<net.Server> {
  const srv = net.createServer((sock) => {
    sock.on("error", () => {});
    sock.write("+OK mock POP3 ready\r\n");
    sock.on("data", (d) => {
      for (const line of d.toString().split("\r\n").filter(Boolean)) {
        const c = line.trim().split(/\s+/)[0].toUpperCase();
        if (c === "STAT") sock.write("+OK 0 0\r\n");
        else if (c === "UIDL") sock.write("+OK\r\n.\r\n");
        else if (c === "QUIT") { sock.write("+OK bye\r\n"); sock.end(); }
        else sock.write("+OK\r\n");
      }
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

/** captured raw mail → 디코딩된 text/plain 본문 (buildMessage는 base64 인코딩) */
function textOf(mail: Captured): string {
  const chunks = mail.data.split(/Content-Type: text\/plain[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
  if (chunks.length < 2) return "";
  const b64 = chunks[1].split(/\r\n\r\n|--/)[0].replace(/\s/g, "");
  try { return Buffer.from(b64, "base64").toString("utf8"); } catch { return ""; }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function main() {
  const smtpSrv = await startMockSmtp(2525);
  const pop3Srv = await startMockPop3(110);
  note("INFO", `목 서버 가동 — SMTP:2525, POP3:110 · boss=${BOSS_EMAIL}`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // ── 대표: 가입 → 회사 생성 ────────────────────────────────────────────────
  const bossCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  const b = await bossCtx.newPage();
  b.setDefaultTimeout(30000);

  await b.goto(`${BASE}/signup`);
  await settle(b);
  await b.click('button:has-text("새 회사 만들기")');
  await b.fill('input[name="companyName"]', `이캄스테스트 ${RUN}`);
  await b.fill('input[name="name"]', "김대표");
  await b.fill('input[name="email"]', BOSS_EMAIL);
  await b.fill('input[name="password"]', "pass123!");
  await b.getByRole("button", { name: "회사 만들기", exact: true }).click();
  await b.waitForURL("**/dashboard");
  note("OK", "가입·회사 생성 → 대시보드");
  await shot(b, "dashboard-empty");

  // ── 메일 연결 (목 POP3/SMTP) ──────────────────────────────────────────────
  await b.goto(`${BASE}/mail`);
  await settle(b);
  await b.fill('input[name="email"]', BOSS_EMAIL);
  await b.fill('input[name="password"]', "mailpw");
  await b.click("summary:has-text('고급 설정')");
  await b.fill('input[name="host"]', "127.0.0.1");
  await b.fill('input[name="port"]', "110");
  await b.fill('input[name="smtpHost"]', "127.0.0.1");
  await b.fill('input[name="smtpPort"]', "2525");
  await b.click('button:has-text("자동으로 찾아 연결")');
  await b.waitForSelector("text=연결 해제"); // 성공 시 연결된 화면으로 (redirect는 플레인 /mail)
  note("OK", "메일 연결 성공 (POP3 110 / SMTP 2525)");
  await shot(b, "mail-connected");

  // ── 지시하기: 2단계 꼭지 확정 ─────────────────────────────────────────────
  await b.goto(`${BASE}/capture`);
  await settle(b);
  await b.fill('textarea[name="rawText"]',
    "다음 주 금요일까지 신제품 포장재 견적 진행해주세요. 단가표 회신해 주시고, 납기 일정과 최소 발주 수량도 함께 알려주세요.");
  await b.fill('input[name="to"]', PARTNER_EMAIL);
  await shot(b, "capture-step1");
  await b.click('button:has-text("꼭지 나누어 다듬기")');
  await b.waitForSelector("text=2단계");
  await shot(b, "capture-step2-preview");

  const boxes = b.locator('input[type="checkbox"]');
  const taskCount = await boxes.count();
  note("INFO", `AI 분해 결과: 꼭지 ${taskCount}개`);
  if (taskCount >= 2) {
    await boxes.last().uncheck(); // 제거 테스트
    note("OK", "마지막 꼭지 체크 해제 (선택 제거)");
  }
  const firstTitle = b.locator(".card .flex-1 input").first();
  const orig = await firstTitle.inputValue();
  await firstTitle.fill(`${orig} (수정확인)`); // 수정 테스트
  await shot(b, "capture-step2-edited");
  await b.click('button:has-text("항목으로 보내고 등록")');
  await b.waitForURL("**/instructions/**");
  const instUrl = b.url();
  note("OK", `발송+등록 완료 → ${instUrl}`);
  await shot(b, "instruction-created");

  // ── 발송 메일 검증 (목 SMTP 캡처) ────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 1500));
  const askMail = captured.find((c) => c.rcpt.some((r2) => r2.includes("partner")));
  if (!askMail) throw new Error("지시 메일이 목 SMTP에 잡히지 않았습니다");
  const askText = textOf(askMail);
  if (askText.includes("요청 항목") && askText.includes("(수정확인)")) {
    note("OK", "메일 본문에 요청 항목 + 지시자가 수정한 제목이 그대로 실림 (일의 전후)");
  } else {
    note("ISSUE", `메일 본문 검증 실패:\n${askText.slice(0, 400)}`);
  }
  if (/References: <fd-[^>]+>/.test(askMail.data)) note("OK", "References 헤더 탑재 (Message-ID 재작성 생존 장치)");
  else note("ISSUE", "References 헤더 없음");
  const replyUrl = askText.match(/https?:\/\/[^\s]+\/r\/[a-f0-9-]+/)?.[0];
  if (!replyUrl) throw new Error("메일에서 직답 링크를 못 찾음");
  note("INFO", `직답 링크: ${replyUrl}`);

  // ── 상대방(무계정): 직답 페이지에서 답변+파일 ────────────────────────────
  const partnerCtx = await browser.newContext({ viewport: { width: 480, height: 900 }, locale: "ko-KR" });
  const p = await partnerCtx.newPage();
  p.setDefaultTimeout(30000);
  await p.goto(replyUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await settle(p);
  const pageHasTasks = await p.locator("text=요청 항목").count();
  note(pageHasTasks ? "OK" : "ISSUE", `직답 페이지 요청 항목 표시: ${pageHasTasks ? "보임" : "안 보임"}`);
  await shot(p, "reply-page");
  await p.fill('input[name="responder"]', "박상무 (포장재)");
  await p.fill('textarea[name="content"]',
    "1. 단가표 첨부드립니다 — 개당 320원입니다.\n2. 납기는 발주 후 2주, 최소 발주 수량은 5,000개입니다.");
  // 파일명은 ASCII로 — 이 샌드박스의 Playwright는 한글 파일명 setInputFiles가
  // 조용히 실패한다 (제품 문제 아님: curl로 한글 파일명 업로드는 정상 저장됨)
  const filePath = `${SHOTS}/pricelist.txt`;
  writeFileSync(filePath, "포장재 단가표\n개당 320원 (5,000개 이상)\n");
  await p.setInputFiles('input[type="file"]', filePath);
  await shot(p, "reply-filled");
  await p.click('button:has-text("답변 보내기")');
  await p.waitForSelector("text=답변이 전달되었습니다");
  note("OK", "직답 제출 완료 (무계정 · 파일 첨부)");
  await shot(p, "reply-done");

  // ── 대표: 답장 도착 확인 → 수행됨 처리 ───────────────────────────────────
  await b.goto(instUrl);
  await settle(b);
  const arrived = await b.locator("text=답장 도착").count();
  const hasBody = await b.locator("text=개당 320원").count();
  const hasFile = await b.locator("text=pricelist.txt").count();
  note(arrived ? "OK" : "ISSUE", `지시 페이지 ✉ 답장 도착 배지: ${arrived ? "표시됨" : "없음"}`);
  note(hasBody ? "OK" : "ISSUE", `답변 내용 기록: ${hasBody ? "보임" : "없음"}`);
  note(hasFile ? "OK" : "ISSUE", `첨부파일 기록: ${hasFile ? "보임" : "없음"}`);
  await shot(b, "instruction-reply-arrived");

  await b.fill('input[name="outcome"]', "단가 320원/납기 2주 확인 — 발주 진행");
  await b.click('button:has-text("이 답장으로 완료")');
  await settle(b);
  await shot(b, "instruction-completed");
  note("OK", "✅ 수행됨 처리 (결과 한 줄 기록)");

  // ── 시나리오 A: 빠른 보내기 (AI 초안 · 요청 항목 없는 메일 · 답장 대기) ──
  const PARTNER2 = `partner2-${RUN}@test.local`;
  await b.goto(`${BASE}/capture`);
  await settle(b);
  // 이전 발송 상대가 DB 원장 칩으로 떠야 한다
  const chipVisible = await b.locator(`button:has-text("${PARTNER_EMAIL}")`).count();
  note(chipVisible ? "OK" : "ISSUE", `과거 상대 추천 칩: ${chipVisible ? "보임" : "없음"}`);
  await b.fill('textarea[name="rawText"]', "내일까지 포장재 샘플 3종 보내주실 수 있는지 확인 부탁합니다.");
  await b.fill('input[name="to"]', PARTNER2);
  await shot(b, "quick-send");
  await b.click('button:has-text("바로 보내기")');
  await b.waitForURL("**/instructions/**");
  const quickInstUrl = b.url();
  await settle(b);
  const waiting = await b.locator("text=답장 대기").count();
  note(waiting ? "OK" : "ISSUE", `빠른 보내기 → 지시 생성 + 답장 대기: ${waiting ? "✅" : "❌"}`);
  await new Promise((r) => setTimeout(r, 1200));
  const quickMail = captured.find((c) => c.rcpt.some((r2) => r2.includes("partner2")));
  if (!quickMail) note("ISSUE", "빠른 보내기 메일이 목 SMTP에 없음");
  else {
    const qt = textOf(quickMail);
    note(!/요청 항목/.test(qt) ? "OK" : "ISSUE", "간단 지시 메일에 요청 항목 블록 없음 (중복 방지)");
    note(/\/r\/[a-f0-9-]+/.test(qt) ? "OK" : "ISSUE", "빠른 보내기 메일에도 직답 링크 포함");
  }
  void quickInstUrl;

  // 증빙 전달 사본 (best-effort) 확인
  await new Promise((r) => setTimeout(r, 2000));
  const fwd = captured.find((c) => c.rcpt.some((r2) => r2.includes("boss")) && /Saydog|직답/.test(textOf(c)));
  note(fwd ? "OK" : "INFO", `증빙 전달 사본(내 메일함 스레드): ${fwd ? "발송 캡처됨 (첨부 포함)" : "미캡처 (best-effort 경로)"}`);

  await browser.close();
  smtpSrv.close();
  pop3Srv.close();

  console.log("\n══ 결과 요약 ══");
  for (const f of findings) console.log(f);
  const issues = findings.filter((f) => f.startsWith("[ISSUE]"));
  console.log(`\n${issues.length === 0 ? "🎉 전체 루프 통과" : `⚠ 문제 ${issues.length}건`} · 스크린샷: ${SHOTS}`);
  process.exit(issues.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 실패:", e);
  process.exit(1);
});
