# HANDOFF — 세션 인수인계 문서

> 다른 세션(사람/AI)이 이 프로젝트를 이어받아 검토·개발할 수 있도록 정리한 현재 상태.
> 마지막 갱신: 2026-08-12, 브랜치 `claude/groupware-workflow-automation-spinkz`, HEAD `f415532`.

---

## 1. 제품이 무엇인가

**Saydog** (구 FlowDesk — 코드/UI에는 아직 FlowDesk가 남아 있음, 리네이밍 미적용):
한국 SMB를 위한 **1인칭 약속 관리** 그룹웨어. "말한 것(Say)과 한 것(Do)의 간극"을 추적한다.

- Jira/Asana류와의 차이: 그들은 **3인칭·객체 중심**(팀 전원이 가입해 티켓을 내려다보는 지도). Saydog은 **1인칭·관계 중심**("내가 누구에게 무엇을 맡겼고 답이 왔는가"). 상대방은 **계정이 필요 없다**.
- 핵심 루프: 지시(SAY) 생성 → 메일 발송 → 상대 답변(DO) → 검토 게이트 → 완료. 대시보드에 ✉ 답장 도착 표시.
- 네이밍: Saydog 확정 (say-do + 충직한 개 마스코트, Datadog 선례). saydog.com은 $3,795라 보류 — saydog.app / getsaydog 사용 예정.

## 2. 핵심 아키텍처 — 직답(直答) 버튼 ★가장 중요★

**수신 메일 인프라(도메인/MX/웹훅/IMAP 폴링) 전부 없이** 답변을 받는 구조. 창업자가 직접 설계.

```
앱에서 지시 작성 → 발신 메일에 [✍️ 바로 답변하기] 버튼 포함
  → 상대(무계정)가 공개 웹페이지 /r/{token} 에서 답변 + 파일 첨부
  → DB에 직행 (comment + ReplyFile + 알림 + 감사로그)
  → 동시에 지시자 본인 메일함으로 스레드 답장 자동 전달 (In-Reply-To, 첨부 포함) = 증빙
```

- 상대방 관점: 버튼 하나, 로그인 없음, "별도의 메일 회신은 필요 없습니다".
- 이 구조 덕에 Gmail 읽기 스코프·CASA 감사·수신 서버가 전부 불필요.
- **2026-08-12 창업자가 프로덕션에서 전체 루프 작동 확인** ("잘 돌아 가는데").
- 토큰 수명: **90일 TTL + 지시 ARCHIVED 시 즉시 만료** (`src/lib/reply-token.ts`) — 유출 링크가 영원히 살지 않는다. 1회성은 의도적으로 안 함(견적 보완 등 정당한 재답변이 흔함).
- ⚠ 냉정한 평가: 이 패턴 자체는 발명이 아니다 — Smartsheet Update Request가 "무계정 상대 폼 응답 → 행 반영"을 이미 한다. 기술 해자가 아니라 **수요 검증**으로 읽을 것. 해자는 §4-가 참조.

## 3. 메일 스택 (모두 자체 구현, 외부 의존성 0)

| 계층 | 파일 | 내용 |
|---|---|---|
| Gmail OAuth | `src/lib/gmail.ts` | **send 단독 스코프** (openid/email/gmail.send) — 메일함을 한 글자도 못 읽음. Message-ID는 우리가 직접 생성(RFC 5322, Gmail이 보존) → read-back 불필요 |
| 직답 토큰 수명 | `src/lib/reply-token.ts` | 순수 로직: 90일 TTL + ARCHIVED 즉시 만료. 코어와 /r 페이지가 공유 |
| IMAP | `src/lib/connector.ts`, `mail-fetch.ts` | 993 implicit TLS / 143 STARTTLS |
| POP3 | `src/lib/pop3.ts` | USER/PASS/UIDL/TOP/RETR, dot-stuffing — Nmail 등 국산 POP3-전용 서버 대응 |
| SMTP | `src/lib/smtp.ts` | STARTTLS, AUTH LOGIN 아이디 형태 재시도(bare id ↔ full address), multipart/mixed 첨부, RFC2047 한글 헤더, In-Reply-To 스레딩, self-signed 인증서 opt-in, POP-before-SMTP |
| 자동감지 | `src/lib/mail-autodetect.ts` | MX 조회 + 993/143/995/110/465/587 병렬 포트 프로브 — "이메일+비번만으로 연결" |
| 능력 모델 | `src/lib/mail-capabilities.ts` | 포트→기능표(POP3면 보낸함 조회 불가 등) + 제공자별 ①②③ 설정 레시피 |
| 헤더 파싱 | `src/lib/mail-headers.ts` | RFC2047 B/Q, EUC-KR/ks_c_5601, multipart 본문 추출 |
| 직답 코어 | `src/lib/external-reply-core.ts` | processExternalReply: 검증→comment→ReplyFile(≤3개, ≤5MB)→알림→스레드 전달(best-effort) |
| 발송 | `src/app/actions/mail.ts` | composeAndSend: 수신자별 개별 발송 기본, replyToken 발급, gmail/SMTP 분기, 부분 실패 상세 표시 |
| 공개 답변 | `src/app/r/[token]/page.tsx` + `src/app/api/reply/[token]/route.ts` | multipart는 **route handler** 필수 (server action은 File을 빈 껍데기로 직렬화함!) |

## 4. 전략 결정 (확정된 것)

1. **주 타깃: Gmail/글로벌.** 레거시 국산 사내메일(Nmail 등) 지원은 완성 상태로 동결 — 해자(moat)로 유지.
2. **Gmail 스코프는 send 단독.** ~~"metadata+send라 CASA 부담 최소"~~ ← **이전 판단은 오류였음**: `gmail.metadata`는 Google **restricted** 목록에 있어 연 단위 CASA 평가를 트리거한다. 2026-08-12 외부 리뷰가 잡아냄 → metadata 스코프 제거 완료. 이제 sensitive(`gmail.send`)만 남아 **검증만 통과하면 CASA 없음**. Message-ID는 자체 생성(Gmail이 보존), Gmail 연결은 메일함 목록·답장 폴링 없음(직답이 대체). 절대 읽기 스코프를 다시 넣지 말 것 — `tests/reply-token.test.ts`에 가드 테스트 있음.
3. **로그인 OAuth와 메일 OAuth는 별도 클라이언트/프로젝트.** 로그인(openid/email/profile)은 심사 없이 프로덕션 게시 가능 → 무제한. 키: `GOOGLE_CLIENT_ID/SECRET`(로그인) vs `GOOGLE_MAIL_CLIENT_ID/SECRET`(메일).
4. 주소록은 **자체 거래처 원장**(과거 수신자 기록)으로 — People API 안 씀.
5. Gmail Add-on 판매는 성장 단계 과제 (ROADMAP 2.9, Marketplace는 결제 대행 안 함).

## 4-가. 경쟁 지형과 해자 (2026-08-12 외부 리뷰 반영)

**선례 지도** — 카테고리는 비어 있지 않다:
- Smartsheet **Update Request**: 무계정 상대에게 폼 링크 → 응답이 행에 반영. 우리 직답 패턴의 직접 선례 (수요 증명 + 기술 해자 아님의 증거).
- 요청 폼 계열(Wrike/Asana/Airtable 폼, Jotform Approvals): 외부인 무계정 입력 → 내부 레코드.
- 클래식 **Outlook Assign Task**: 수락/거절·진척 동기화 — 사실상 직계 조상. MS가 버린 것은 기회이자 경고.
- 국내 그룹웨어(하이웍스·다우오피스·네이버웍스·더존): 전자결재 중심, 저가 — **정면 충돌 금지**.
- 빈 것은 시장이 아니라 **프레이밍**: "1인칭 지시-이행 추적"으로 포지셔닝한 곳이 없다. (폼=수집, 결재=사전승인 / 우리=사후 이행 확인.)

**해자 서열 (사업 가치 순)**:
1. **증빙(evidence) 포지셔닝** — 지시 원문+응답+첨부+타임스탬프가 발신자 메일함 스레드에 남는다. 안전지시 이행, 하도급 시정조치, 감사 대응. 한국 SMB에서 "관리 편의"보다 강한 구매 동기 → **제품의 1번 주장으로 올릴 것**.
2. **1인칭 과금 구조** — 지시자만 결제, 수신자 N명 무료. 그룹웨어 1만원×150석 대신 관리자 10명×3만원: 총액은 작아도 도입 마찰 최소, seat 경제학 유리.
3. 레거시 국산 메일 대응 — 진짜 해자지만 지키는 시장의 상한이 낮다(줄어드는 시장).
직답 버튼 자체는 해자가 아님 — 유능한 팀이면 이틀에 복제.

**리스크 대장**:
- 피싱 오탐: 무계정 토큰 링크+파일 업로드 요구 = 사내 메일 게이트웨이가 싫어하는 형태(링크 리라이팅·격리). 대기업 협력사일수록 심함. 미해결.
- 토큰=증빙의 약점: 90일 TTL+ARCHIVED 만료로 1차 방어(구현됨). 수신자 이메일 확인은 미구현 — 증빙 포지셔닝 강화 시 필요.
- Resend(플랫폼 발송) 전환은 **도달률 후퇴** — 현재 사용자 본인 메일함 발송이 도달률 최적. 제로-설정 온보딩과 맞바꿀 가치 신중히.
- **최대 리스크는 입력 지점**: 실제 지시는 카톡·전화·회의에서 나간다. 사장이 앱을 열어 지시를 "작성"하는 습관이 유일한 병목. 회의록·음성·카톡에서 SAY 후보 자동 추출이 장기적으로 진짜 제품이고, 직답 버튼은 그 뒤의 배관.

## 5. 프로덕션 환경

- **Railway** 배포, URL `https://fde-production-dc2f.up.railway.app`, Node 18 런타임 (engines >=20 핀 완료).
- Next.js 15 App Router (`output: standalone`), Prisma + PostgreSQL.
- `package.json` start = `prisma migrate deploy && next start` (마이그레이션 자동).
- **환경변수**: `APP_URL`, `DATABASE_URL`, `ENCRYPTION_KEY`(메일 자격증명 암호화), `GOOGLE_MAIL_CLIENT_ID/SECRET`(설정됨, 메일 연결용), `GOOGLE_CLIENT_ID/SECRET`(**미설정 — 구글 로그인이 안 보이는 유일한 이유**).

### 프로덕션에서 배운 함정 (전부 수정 완료 — 재발 주의)

- Server Action으로 파일 업로드 금지: File이 size 0 껍데기로 직렬화됨 → route handler multipart 사용.
- Node 18에는 global `File` 없음 → duck-typing (`arrayBuffer` 함수 + numeric `size`).
- Railway 프록시 뒤에서 `req.url`은 내부 localhost → 모든 redirect는 `appUrl()` (`src/lib/app-url.ts`, 스킴 없으면 https:// 자동 부착).
- OAuth 리디렉션 URI는 **웹 애플리케이션** 유형 클라이언트에 정확히 등록 (데스크톱 유형 불가).
- 국산 메일서버: self-signed cert, "503 Authentication failed"(비표준), bare-code 응답("221"), POP-before-SMTP — 전부 처리 코드 있음.
- Prisma `Bytes`에는 `new Uint8Array(buf)`.

## 6. 테스트

```bash
npx tsx tests/run.ts   # 174개 전부 통과 (2026-08-12 기준)
```
스위트: inbound-email, connector, crypto, mail-headers, pop3, mail-capabilities, smtp, mail-autodetect, reply-token(스코프 가드 포함), migrations. 네트워크 없이 순수 로직만 검증.

## 7. 남은 일 (우선순위 순 — 2026-08-12 리뷰로 재서열)

1. ~~gmail.metadata 제거 (자체 Message-ID 생성)~~ — **완료** (send 단독 스코프, 가드 테스트 포함). 창업자가 `/mail`에서 Google 재연결 한 번 하면 새 동의 화면(발송 권한만)으로 갱신됨 — 기존 토큰도 동작은 하므로 급하지 않음.
2. **CAMS 도그푸딩이 다음 관문.** 관리자 10~15명, 2주. 지표 딱 둘: **응답률**(상대가 직답 버튼을 실제로 누르는가), **2주차 지시자 잔존율**(사장이 계속 앱을 여는가). 잔존율이 무너지면 나머지는 볼 필요 없음. 제품은 성립했고 미검증은 "돈을 내는가"다.
3. **구글 로그인 활성화 — 창업자 액션만 남음.** 코드는 완성(`SocialButtons` + `configuredProviders()` + 콜백). 필요한 것: 별도 **게시된** GCP 프로젝트에 웹 클라이언트 생성, 리디렉션 URI `https://fde-production-dc2f.up.railway.app/api/auth/google/callback`, Railway에 `GOOGLE_CLIENT_ID/SECRET` 추가. (도그푸딩이 사내에서 도는 동안 편의 항목 — 잔존율보다 후순위.)
4. **온보딩 재설계 — 대기실 패턴(Option B) 합의됨.** 구글 로그인 → 선택 화면(새 회사 만들기 / 초대 코드 / 도메인 자동합류). 신규 소셜 유저는 현재 `/complete`(CompleteForm)로 가는데 이미 절반쯤 구현된 상태 — 여기서 확장할 것. 스키마 변경 없음, User 레코드는 선택 후 생성.
5. **Saydog 리네이밍 코드 전체 적용** (현재 UI 곳곳에 FlowDesk 잔존, 예: `/complete` 로고).
6. 도메인 구매(saydog.app), Gmail Add-on(성장 단계). 플랫폼 발송(Resend)은 도달률 후퇴 리스크(§4-가)와 함께 재검토.
7. (장기, §4-가) 직답 수신자 이메일 확인 · 카톡/회의록에서 SAY 자동 추출.

## 8. 창업자와의 협업 규칙 (standing instructions)

- 창업자가 **영어로 쓰면**: 자연스러운 표현으로 고쳐주고 조언한 뒤 답변 (영어 코칭).
- 창업자가 **한국어로 쓰면**: 답변에 그 문장의 영어 번역을 함께 제공 (영어 연습).
- 실존 이메일 주소로 테스트 발송 금지 — 테스트 계정만 사용.
- 답변은 한국어 기본.

## 9. 빠른 검증 시나리오 (프로덕션 확인용)

1. `/mail`에서 지시 작성·발송 → 즉시 열림(목록은 📥 버튼 누를 때만 조회 — lag 수정분).
2. 수신 메일의 [✍️ 바로 답변하기] → `/r/{token}`에서 답변+파일 제출.
3. 대시보드에 ✉ 답장 도착 + comment/파일 기록 + 지시자 메일함에 스레드 답장 확인.
