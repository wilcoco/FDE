# 인수인계: "지시→꼭지→검수" 모듈 이식 가이드

> 다른 프로젝트에 **별개의 메뉴(모듈)** 로 그대로 붙이기 위한 전달 문서.
> 이 문서 하나로 개발자(또는 AI 코딩 에이전트)가 호스트 프로젝트에 이식을 완료할 수 있도록 작성됨.
> 원본 저장소: `wilcoco/FDE` (main 브랜치)

---

## 1. 모듈이 하는 일 (범위)

**"대표의 말 한마디 → 실행 → 결과 확인"을 닫는 루프.** BPM/워크플로우 엔진이 아니라, 굵직한 매듭(꼭지)만 관리한다.

1. **지시 캡처** — 대표가 말(음성 STT)이나 글로 지시 → AI가 **꼭지 3~6개**(제목·순서·기대결과)로 분해. AI 불가 시 휴리스틱 폴백(서비스 무중단).
2. **실행 관리** — 꼭지별 담당자 배정(알림), 상태(대기/진행/막힘/검수/완료), 기한, 결과·증빙(링크/메모) 축적. 완료 확정 시 다음 꼭지 자동 시작.
3. **검수 관문** — 담당자의 "완료"는 **주장**으로 취급 → `REVIEW` 상태. 지시자(또는 관리자)가 기대결과 대비 **확인(확정)** 또는 **반려(사유와 함께 진행 복귀)**.
4. **정체 감시(watchdog)** — 기한초과(시작 전 포함)·무소식(기본 3일)·검수방치(2일)를 감지해 담당자+지시자에게 알림. 24h 중복 방지. 페이지 접속 시 지연 실행(10분 스로틀) + cron 스크립트.
5. **전략 통일성** — 누적 지시들을 AI가 교차 해석: 주제 그룹 / 모순 쌍 / 고아 지시 / 목표 매핑. 새 지시 3건마다 자동 재분석. 그룹에 지시 ≥3건이면 "반복 감지" 표시.
6. **알림 설정** — 사용자별 알림 7종 × (인앱/이메일) 토글. 발송 지점 중앙 검사.

**핵심 설계 사상 (바꾸지 말 것):**
- 꼭지는 BPM이 아니다 — 세부 절차는 조직이 알아서, 시스템은 **순서와 결과**만.
- 완료는 주장이고, 확정은 지시자의 권한이다 (say-do gap 봉합의 핵심).
- AI 없는 통일성을 지어내지 않는다 — 안 묶이면 솔직하게 orphan.
- AI 실패/타임아웃 시 휴리스틱 폴백으로 **항상 동작**한다.

---

## 2. 호스트 프로젝트가 제공해야 하는 것 (통합 경계 5가지)

모듈은 아래 5가지 seam만 호스트에 맞게 바꾸면 나머지는 그대로 동작한다.

| # | Seam | 원본 파일 | 호스트가 대체 구현할 것 |
|---|---|---|---|
| 1 | **신원/세션** | `src/lib/session.ts` `requireContext()` | `{ user: {id, name, role}, org: {id} }` 를 반환하는 함수. 모든 액션/페이지 첫 줄에서 호출됨 |
| 2 | **권한 판정** | `src/lib/rbac.ts` `atLeast(role,"ADMIN")` | "검수 확정 가능자" 판정: `지시자 본인 OR 관리자`. 호스트 역할 체계에 맞게 boolean 하나만 |
| 3 | **조직 구성원 목록** | `prisma.user.findMany({tenantId})` | 배정 드롭다운용: 같은 조직의 `{id, name}[]` |
| 4 | **DB** | Prisma + PostgreSQL | 아래 §4 모델 3개+열 2개. `tenantId` → 호스트의 조직 FK로 개명 가능 |
| 5 | **알림 싱크** | `src/lib/notify.ts` | 인앱: Notification 테이블(포함됨) 또는 호스트 알림함으로 라우팅. 이메일: `sendNotificationEmail` (Resend, 선택) |

호스트가 Next.js(App Router) + Prisma면 seam 1~3만 바꾸면 되고, 다른 스택이면 §5의 순수 로직/프롬프트를 가져가서 액션 레이어만 재작성한다.

---

## 3. 복사할 파일 목록 (역할별)

### A. 순수 로직 — 스택 무관, 무수정 복사 (가장 가치 높음)
```
src/lib/milestone-rules.ts   ← 검수 관문 전이 규칙 + 정체/기한/방치 판정 + 넛지 중복 방지 (전부 순수함수)
src/lib/notify-prefs.ts      ← 알림 카테고리 정의 + 채널 판정 (fail-open: 깨진 설정에도 알림 유실 없음)
src/lib/rate-limit.ts        ← 인메모리 레이트리밋 (로그인 5회/10분 등)
tests/milestone-rules.test.ts, tests/notify-prefs.test.ts, tests/rate-limit.test.ts  ← 이 규칙들의 적대적 테스트 51케이스. 반드시 같이 가져가서 이식 후 실행
```

### B. AI 계층 — 프롬프트+폴백 포함, 무수정 복사
```
src/lib/ai.ts        ← generateMilestones / regenerateMilestones / synthesizeStrategy (+ 각 휴리스틱 폴백, 45s 타임아웃 레이스)
                        ※ generateProcess는 프로세스 엔진용 — 이 모듈엔 불필요, 지워도 됨
src/lib/stt.ts       ← 음성→텍스트 (OpenAI Whisper, 플러그형; 미설정 시 브라우저 Web Speech 폴백)
src/lib/mail.ts      ← Resend 발송 + HTML 이스케이프 (미설정 시 무해한 no-op)
```
의존 패키지: `@anthropic-ai/sdk` 하나뿐. 모델: 무거운 작업 `claude-opus-4-8`(현 시점 최신 상위 모델 권장), 저지연 `claude-haiku-4-5`.

### C. 서비스 계층 — seam 치환 후 복사
```
src/lib/sweep.ts             ← 정체 감시 실행기 (sweepTenant / maybeSweep / attentionSummary)
src/lib/synthesis.ts         ← 전략 합성 실행기 + 자동 트리거(3건 규칙)
src/lib/notify.ts            ← 알림 중앙 발송(설정 검사 포함)
src/app/actions/capture.ts   ← 전 기능의 서버 액션 13개 (지시 캡처~검수까지)
src/app/actions/settings.ts  ← 알림 설정 저장
scripts/sweep.ts             ← cron용 일괄 스윕
```

### D. UI — Tailwind 기반, 메뉴 6개
```
src/components/MilestoneViews.tsx   ← 플로우(순서)·보드(상태) 2뷰
src/components/VoiceCapture.tsx     ← 음성/텍스트 입력
src/components/SubmitButton.tsx     ← pending 스피너
src/app/(app)/capture/page.tsx          ← [메뉴1] 지시하기
src/app/(app)/instructions/page.tsx     ← [메뉴2] 지시 목록
src/app/(app)/instructions/[id]/page.tsx← [메뉴2-상세] 꼭지 관리 + 검수 UI + 재지침
src/app/(app)/strategy/page.tsx         ← [메뉴3] 전략 통일성 (※ 템플릿 승격 버튼은 프로세스 엔진 의존 — 없으면 그 form만 제거)
src/app/(app)/inbox/page.tsx            ← [메뉴4] 받은 업무 중 "검수 대기"·"내 꼭지" 섹션만 발췌
src/app/(app)/settings/page.tsx         ← [메뉴5] 알림 설정
src/app/api/stt/route.ts                ← 음성 업로드 엔드포인트
대시보드 "🚨 주의 필요" 카드 → dashboard/page.tsx에서 attentionSummary 사용 부분 발췌 [메뉴6 또는 위젯]
```
스타일 전제: `globals.css`의 `@layer components` 유틸 클래스(`.card .btn .btn-ghost .btn-danger .input .label .badge .th .td`)를 함께 복사하거나 호스트 디자인 시스템으로 치환.

### E. 가져가지 말 것 (이 모듈 범위 밖)
- 프로세스 엔진 전체 (ProcessDefinition/Instance, engine.ts, approval.ts, 전결규정)
- 조직도/OKR/멤버 관리/소셜 로그인/가입 요청 — 호스트에 이미 있을 기능
- `generateProcess` 및 strategy 페이지의 "템플릿 승격" 폼

---

## 4. 데이터 모델 (PostgreSQL DDL)

`tenantId`는 호스트의 조직 FK로, `authorId/ownerId`는 호스트 사용자 FK로 개명해도 된다. 로직에서 이 컬럼을 참조하는 곳은 전부 §3-C 파일 안에 있다.

```sql
CREATE TYPE "InstructionSource" AS ENUM ('TEXT','VOICE');
CREATE TYPE "InstructionStatus" AS ENUM ('ACTIVE','ARCHIVED');
CREATE TYPE "MilestoneStatus"  AS ENUM ('PENDING','ACTIVE','BLOCKED','REVIEW','DONE');

CREATE TABLE "Instruction" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  "rawText" TEXT NOT NULL, summary TEXT,
  source "InstructionSource" NOT NULL DEFAULT 'TEXT',
  status "InstructionStatus" NOT NULL DEFAULT 'ACTIVE',
  "objectiveId" TEXT,                       -- 호스트 목표체계 연결(선택)
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX ON "Instruction"("tenantId", "createdAt");

CREATE TABLE "Milestone" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "instructionId" TEXT NOT NULL REFERENCES "Instruction"(id) ON DELETE CASCADE,
  "order" INT NOT NULL DEFAULT 0, title TEXT NOT NULL,
  "expectedResult" TEXT, "ownerId" TEXT,
  status "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
  proof JSONB NOT NULL DEFAULT '[]',        -- [{type:'link'|'note', value, by, at}]
  "dueAt" TIMESTAMP(3), "activatedAt" TIMESTAMP(3), "doneAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),               -- 검수 제출 시각
  "returnNote" TEXT,                        -- 반려 사유 (확정 시 NULL)
  "lastNudgeAt" TIMESTAMP(3),               -- 넛지 중복 방지
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX ON "Milestone"("tenantId","ownerId",status);
CREATE INDEX ON "Milestone"("instructionId");

CREATE TABLE "StrategySynthesis" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}',       -- {groups, contradictions, orphans, goalMap}
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX ON "StrategySynthesis"("tenantId","createdAt");

-- 호스트 기존 테이블에 추가할 열
ALTER TABLE "User"   ADD COLUMN "notifyPrefs" JSONB NOT NULL DEFAULT '{}';  -- 알림 설정
ALTER TABLE "Tenant" ADD COLUMN "lastSweepAt" TIMESTAMP(3);                 -- 스윕 스로틀

-- 인앱 알림함이 없는 호스트라면 (있으면 notify.ts를 호스트 알림함으로 연결)
CREATE TABLE "Notification" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT,
  "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX ON "Notification"("tenantId","userId","readAt");
```

---

## 5. 반드시 보존해야 하는 동작 규칙 (명세)

구현이 아니라 **규칙**이 자산이다. 전부 `milestone-rules.ts` + 테스트에 코드화되어 있음.

**검수 관문**
- 담당자(비지시자·비관리자)의 `DONE` 요청 → `REVIEW` + `submittedAt` + 지시자 알림
- 지시자/관리자의 `DONE` → 즉시 확정(`doneAt`, `returnNote` 초기화) + **다음 PENDING 꼭지 자동 ACTIVE**
- 반려: `REVIEW→ACTIVE` + `returnNote`(빈 값이면 기본 문구) + `submittedAt` 초기화 + 담당자 알림
- 이미 REVIEW인 건 재제출해도 재알림 없음(스팸 방지)
- 검수 권한: `지시자 본인 OR 관리자` — 상태가 REVIEW일 때만 확정/반려 가능

**정체 감시**
- overdue: `dueAt < now && status != DONE` (PENDING 포함 — "시작도 안 함"을 잡는 게 목적)
- stalled: `ACTIVE|BLOCKED && now - updatedAt ≥ STALL_DAYS(기본3)일`
- reviewNeglected: `REVIEW && now - submittedAt ≥ 2일` → **지시자에게만**
- 수신자: REVIEW는 지시자만, 그 외 담당자+지시자(동일인 중복 제거)
- 넛지 최소 간격 24h (`lastNudgeAt`), 스윕은 테넌트당 10분 스로틀 + 원자적 클레임(동시요청 중복실행 방지)

**전략 합성**
- 마지막 합성 이후 새 ACTIVE 지시 ≥3건이면 백그라운드 자동 실행 (fire-and-forget, 실패 무시)
- 프롬프트 원칙: "없는 통일성을 지어내지 마라, 안 붙으면 orphan" — ai.ts에 포함됨

**알림 설정**
- 7카테고리 × 2채널, 기본 전부 ON (단, 진행기록 이메일만 OFF)
- **fail-open**: 미지의 타입·깨진 설정 JSON → 무조건 발송 (알림 유실 금지)

**레이트리밋(선택)**
- 로그인 실패 5회/10분(IP+이메일, 성공 시 리셋, 차단 중엔 정답도 거부), 재설정 메일 3/h(이메일)+10/h(IP, 응답 동일·발송만 중단)

---

## 6. 환경 변수

```bash
ANTHROPIC_API_KEY=          # 없으면 휴리스틱 폴백으로 동작(품질 낮음, 죽지 않음)
ANTHROPIC_MODEL=claude-opus-4-8       # 무거운 작업
ANTHROPIC_FAST_MODEL=claude-haiku-4-5 # 꼭지 분해·합성(저지연)
STT_PROVIDER=openai OPENAI_API_KEY= STT_MODEL=whisper-1 STT_LANGUAGE=ko  # 음성(선택)
MAIL_PROVIDER=resend RESEND_API_KEY= MAIL_FROM=   # 이메일 알림(선택)
STALL_DAYS=3               # 무소식 기준일
```

---

## 7. 이식 순서 (권장)

1. **A(순수 로직)+테스트 복사** → 호스트에서 테스트 51케이스 통과 확인 (스택 무관, 5분)
2. §4 DDL 적용 (컬럼명은 호스트 관례로)
3. B(AI 계층) 복사, `ANTHROPIC_API_KEY` 없이 폴백 경로부터 확인
4. seam 1~3 어댑터 작성 (`requireContext`/`atLeast`/구성원 목록 — 파일 2개, 함수 3개)
5. C(액션/서비스) 복사 후 import 경로만 교체
6. D(UI) 복사, 스타일 클래스 치환, 호스트 네비게이션에 메뉴 등록
7. cron 등록(선택): `scripts/sweep.ts` 를 스케줄러에

**인수 기준 (E2E 시나리오 — 원본은 `tests/e2e-scenarios.ts`):**
- [ ] AI 키 없이 지시 입력 → 꼭지 3개 이상 생성됨
- [ ] 담당자 배정 → 담당자에게 알림
- [ ] 담당자 "완료 제출" → 검수 상태, 지시자에게 알림; 담당자 화면엔 "확인 대기 중" 표시
- [ ] 지시자 반려(빈 사유) → 담당자에게 기본 문구와 함께 복귀
- [ ] 재제출 → 지시자 확정 → 다음 꼭지 자동 시작
- [ ] 기한을 과거로 → 대시보드/주의 필요에 "기한 N일 지남" 표기, 24h 내 중복 넛지 없음
- [ ] 지시 3건 입력 → 전략 분석 자동 생성
- [ ] 알림 설정에서 카테고리 끄면 해당 알림 미발송, 설정 JSON을 임의로 깨뜨려도 알림은 발송됨

---

## 8. 참고 문서 (원본 저장소)

- `docs/REVERSE-PALANTIR.md` — 제품 철학(왜 이런 구조인가)
- `DECISIONS.md` — 의사결정 로그 (특히 "플래그십 피벗", "Say-Do 루프 완성" 섹션)
- `tests/` — 규칙의 실행 가능한 명세 (이식 검증의 기준)
