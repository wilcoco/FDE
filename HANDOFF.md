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
- 이 구조 덕에 Gmail 제한 스코프(readonly)·CASA 감사·수신 서버가 전부 불필요.
- **2026-08-12 창업자가 프로덕션에서 전체 루프 작동 확인** ("잘 돌아 가는데").

## 3. 메일 스택 (모두 자체 구현, 외부 의존성 0)

| 계층 | 파일 | 내용 |
|---|---|---|
| Gmail OAuth | `src/lib/gmail.ts` | metadata+send 스코프(본문 구조적으로 못 읽음=프라이버시), 병렬 메타 fetch, 발송 후 Gmail이 실제 저장한 Message-ID 회수 |
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
2. **Gmail OAuth는 테스트 모드(100명)로 베타 운영.** 스코프가 metadata+send뿐이라 확장 시에도 CASA 부담 최소. readonly 스코프는 채택 안 함(직답 구조로 불필요).
3. **로그인 OAuth와 메일 OAuth는 별도 클라이언트/프로젝트.** 로그인(openid/email/profile)은 심사 없이 프로덕션 게시 가능 → 무제한. 키: `GOOGLE_CLIENT_ID/SECRET`(로그인) vs `GOOGLE_MAIL_CLIENT_ID/SECRET`(메일).
4. 주소록은 **자체 거래처 원장**(과거 수신자 기록)으로 — People API 안 씀.
5. Gmail Add-on 판매는 성장 단계 과제 (ROADMAP 2.9, Marketplace는 결제 대행 안 함).

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
npx tsx tests/run.ts   # 169개 전부 통과 (2026-08-12 기준)
```
스위트: inbound-email, connector, crypto, mail-headers, pop3, mail-capabilities, smtp, mail-autodetect, migrations. 네트워크 없이 순수 로직만 검증.

## 7. 남은 일 (우선순위 순)

1. **구글 로그인 활성화 — 창업자 액션만 남음.** 코드는 완성(`SocialButtons` + `configuredProviders()` + 콜백). 필요한 것: 별도 **게시된** GCP 프로젝트에 웹 클라이언트 생성, 리디렉션 URI `https://fde-production-dc2f.up.railway.app/api/auth/google/callback`, Railway에 `GOOGLE_CLIENT_ID/SECRET` 추가.
2. **온보딩 재설계 — 대기실 패턴(Option B) 합의됨.** 구글 로그인 → 선택 화면(새 회사 만들기 / 초대 코드 / 도메인 자동합류). 신규 소셜 유저는 현재 `/complete`(CompleteForm)로 가는데 이미 절반쯤 구현된 상태 — 여기서 확장할 것. 스키마 변경 없음, User 레코드는 선택 후 생성.
3. **Saydog 리네이밍 코드 전체 적용** (현재 UI 곳곳에 FlowDesk 잔존, 예: `/complete` 로고).
4. 도메인 구매(saydog.app), 추후 플랫폼 발송(Resend)으로 제로-설정 온보딩, Gmail Add-on(성장 단계).

## 8. 창업자와의 협업 규칙 (standing instructions)

- 창업자가 **영어로 쓰면**: 자연스러운 표현으로 고쳐주고 조언한 뒤 답변 (영어 코칭).
- 창업자가 **한국어로 쓰면**: 답변에 그 문장의 영어 번역을 함께 제공 (영어 연습).
- 실존 이메일 주소로 테스트 발송 금지 — 테스트 계정만 사용.
- 답변은 한국어 기본.

## 9. 빠른 검증 시나리오 (프로덕션 확인용)

1. `/mail`에서 지시 작성·발송 → 즉시 열림(목록은 📥 버튼 누를 때만 조회 — lag 수정분).
2. 수신 메일의 [✍️ 바로 답변하기] → `/r/{token}`에서 답변+파일 제출.
3. 대시보드에 ✉ 답장 도착 + comment/파일 기록 + 지시자 메일함에 스레드 답장 확인.
