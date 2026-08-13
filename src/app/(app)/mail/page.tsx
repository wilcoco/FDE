import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadMailConn } from "@/lib/mail-conn";
import { listRecentSent, type ListedMail } from "@/lib/mail-fetch";
import {
  saveMailConnection, deleteMailConnection, registerMailAsSay, syncReplies, composeAndSend, updateSmtpSettings,
} from "@/app/actions/mail";
import { deriveSmtp } from "@/lib/smtp";
import { normalizeMessageId } from "@/lib/inbound-email";
import { capabilitiesFor, MAIL_PRESETS } from "@/lib/mail-capabilities";
import { gmailOAuthConfigured } from "@/lib/gmail";
import PendingButton from "@/components/PendingButton";
import RecipientInput from "@/components/RecipientInput";
import LocalGmail from "@/components/LocalGmail";

// what to tell the user for each connection-failure cause — actionable, not generic
const CONNECT_HINTS: Record<string, string> = {
  auth: "서버에는 연결됐지만 로그인이 거부됐습니다. 사내 서버라면 '로그인 아이디'에 계정 아이디(예: json)를 넣어보세요. 네이버·구글은 원래 비밀번호가 아니라 '앱 비밀번호'가 필요합니다.",
  timeout: "서버가 응답하지 않습니다. 회사 메일이라면 IMAP이 외부망에 안 열려 있을 가능성이 큽니다 — 전산 담당자에게 \"IMAP 993 포트 외부 접속이 되나요?\"라고 확인해보세요.",
  refused: "서버가 이 포트의 접속을 거부했습니다. 포트를 993(안 되면 143)으로 바꿔보세요.",
  dns: "서버 주소를 찾을 수 없습니다. IMAP 서버 주소의 철자를 확인하세요.",
  other: "메일 서버 접속에 실패했습니다. 주소·포트·이메일·비밀번호를 확인해주세요.",
};

export const dynamic = "force-dynamic";

/**
 * 메일 → 지시. Pull model: mail is read from the user's own mailbox ONLY when
 * this screen is opened — no background polling, no mail stored unless the
 * user registers it. Metadata-only by default; per-mail body opt-in.
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string; synced?: string; why?: string; preset?: string; smtp?: string; detail?: string; connected?: string; list?: string;
    host?: string; port?: string; email?: string; login?: string; // echoed back on failure
    to?: string; subject?: string; body?: string; // compose echo on send failure
  }>;
}) {
  const { tenant, user } = await requireContext();
  const {
    error, synced, why, preset, smtp: smtpSaved, detail, connected, list: listParam,
    host: prevHost, port: prevPort, email: prevEmail, login: prevLogin,
    to: prevTo, subject: prevSubject, body: prevBody,
  } = await searchParams;
  const conn = await loadMailConn(user.id);

  // ── not connected yet: setup ──
  if (!conn) {
    const chosen = MAIL_PRESETS.find((p) => p.key === preset) ?? null;
    const defHost = prevHost ?? chosen?.host ?? "";
    const defPort = prevPort ?? (chosen ? String(chosen.port) : "993");
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">📧 메일 연결</h1>
          <p className="mt-1 text-sm text-gray-500">
            내 메일함에서 보낸 메일을 불러와 지시로 등록하고, 답장이 왔는지 추적합니다.
          </p>
        </div>

        {gmailOAuthConfigured() && (
          <a
            href="/api/mail/google"
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium shadow-sm transition hover:bg-gray-50"
          >
            <span className="text-lg">🇬</span> Google 계정으로 메일 연결 (비밀번호 불필요)
          </a>
        )}
        {(error === "oauth_state" || error === "oauth_exchange" || error === "oauth_norefresh") && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Google 연결에 실패했습니다. 다시 시도해주세요.
            {error === "oauth_exchange" && " (테스트 사용자로 등록된 계정인지 확인하세요)"}
          </div>
        )}

        {/* provider presets — set expectations BEFORE the user types anything */}
        <div>
          <div className="mb-2 text-sm font-medium">어느 메일을 연결하나요?</div>
          <div className="flex flex-wrap gap-2">
            {MAIL_PRESETS.map((p) => (
              <Link
                key={p.key}
                href={`/mail?preset=${p.key}`}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  preset === p.key
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
          {chosen && (
            <p className="mt-2 rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-600">{chosen.note}</p>
          )}
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
          <b>메일은 밖으로 나가지 않습니다.</b> 이 화면을 열었을 때만 메일함을 읽고,
          기본은 제목·받는사람·날짜(메타데이터)만 저장합니다. 본문은 메일별로 직접
          선택했을 때만 저장됩니다. 비밀번호는 암호화되어 보관됩니다.
        </div>

        {error === "connect" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {CONNECT_HINTS[why ?? "other"] ?? CONNECT_HINTS.other}
          </div>
        )}
        {error === "missing" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            이메일 주소와 비밀번호를 입력해주세요.
          </div>
        )}
        {error === "detect" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            이 주소의 메일 서버를 자동으로 찾지 못했습니다. 회사 방화벽이 외부 접속을 막고 있거나,
            서버 주소가 관례와 다른 경우입니다. 아래 <b>고급 설정</b>에 서버 주소를 직접 입력해주세요.
          </div>
        )}

        <form action={saveMailConnection} className="card space-y-4">
          <label className="block">
            <span className="text-sm font-medium">이메일 주소</span>
            <input name="email" type="email" placeholder="me@company.co.kr" defaultValue={prevEmail ?? ""} className="input mt-1 w-full" required />
            <span className="mt-1 block text-xs text-gray-400">
              주소만으로 메일 서버를 자동으로 찾아 연결합니다.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">비밀번호</span>
            <input name="password" type="password" className="input mt-1 w-full" required />
            <span className="mt-1 block text-xs text-gray-400">
              네이버·구글·다음은 원래 비밀번호가 아니라 &apos;앱 비밀번호&apos;(2단계 인증 후 발급)를 쓰세요. 회사 메일은 메일 비밀번호 그대로.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">
              로그인 아이디 <span className="font-normal text-gray-400">(이메일 주소와 다를 때만)</span>
            </span>
            <input name="loginUser" placeholder="예: json — 비워두면 이메일 주소로 로그인" defaultValue={prevLogin ?? ""} className="input mt-1 w-full" />
          </label>

          <details open={!!defHost || error === "detect"} className="rounded-md border border-gray-100 p-3">
            <summary className="cursor-pointer text-sm text-gray-500">고급 설정 — 서버를 직접 입력</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <label className="block">
                  <span className="text-sm font-medium">메일 서버 (IMAP 또는 POP3)</span>
                  <input name="host" placeholder="비워두면 자동 감지" defaultValue={defHost} className="input mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">포트</span>
                  <input name="port" type="number" placeholder="993" defaultValue={defHost ? defPort : ""} className="input mt-1 w-full" />
                  <span className="mt-1 block text-xs text-gray-400">IMAP 993 · POP3 995</span>
                </label>
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <label className="block">
                  <span className="text-sm font-medium">SMTP 서버 (보내기)</span>
                  <input name="smtpHost" placeholder="비워두면 자동 감지" className="input mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">포트</span>
                  <input name="smtpPort" type="number" placeholder="465/587" className="input mt-1 w-full" />
                </label>
              </div>
            </div>
          </details>
          <PendingButton pendingLabel="서버 찾고 연결 중… (최대 20초)">자동으로 찾아 연결</PendingButton>
        </form>
      </div>
    );
  }

  // ── connected. The screen renders INSTANTLY — the mailbox is only read
  // when the user asks (?list=1): "메일 조회는 화면 열고 선택하게" ──
  const isGmailConn = conn.provider === "gmail" && !!conn.refresh;
  const caps = capabilitiesFor(conn.port);
  const isPop3 = !isGmailConn && caps.protocol === "pop3";
  const wantList = listParam === "1";
  let mails: ListedMail[] = [];
  let fetchError: string | null = null;
  if (wantList) {
    try {
      mails = await listRecentSent(conn, 20);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "메일함을 읽지 못했습니다";
    }
  }

  // mark rows already registered
  const ids = mails.map((m) => normalizeMessageId(m.messageId)).filter(Boolean);
  const existing = ids.length
    ? await prisma.instruction.findMany({
        where: { tenantId: tenant.id, threadMessageId: { in: ids } },
        select: { id: true, threadMessageId: true, replyReceivedAt: true },
      })
    : [];
  // a multi-recipient mail owns SEVERAL loops (one per counterparty)
  // 자체 주소록: 과거에 맡겼던 상대방 (최근 순, 중복 제거) — People API 불필요
  const pastLoops = await prisma.instruction.findMany({
    where: { tenantId: tenant.id, authorId: user.id, counterparty: { not: null } },
    select: { counterparty: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const recentCounterparties = [...new Set(
    pastLoops.flatMap((r) => (r.counterparty ?? "").split(",").map((e) => e.trim()).filter(Boolean)),
  )].slice(0, 8);

  const byMsgId = new Map<string, typeof existing>();
  for (const r of existing) {
    const k = r.threadMessageId!;
    byMsgId.set(k, [...(byMsgId.get(k) ?? []), r]);
  }

  // browser-local Gmail: the say-do ledger rows the browser needs for reply
  // detection and "등록됨" badges — ids only, no mail content involved
  const gmailTracked = isGmailConn
    ? (
        await prisma.instruction.findMany({
          where: { tenantId: tenant.id, authorId: user.id, source: "EMAIL", threadMessageId: { not: null } },
          select: { id: true, threadMessageId: true, replyReceivedAt: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      ).map((r) => ({ msgId: r.threadMessageId!, instructionId: r.id, replied: !!r.replyReceivedAt }))
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">📧 메일 → 지시</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isGmailConn
              ? `${conn.email} 명의로 발송합니다. 답변은 메일 속 직답 버튼으로 바로 도착합니다.`
              : isPop3
              ? `${conn.email}의 받은편지함 (POP3). 맡긴 일을 지시로 등록하면 답장이 DO로 잡힙니다.`
              : `${conn.email}의 최근 보낸 메일. 맡긴 일을 지시로 등록하면 답장이 DO로 잡힙니다.`}
          </p>
        </div>
        <form action={deleteMailConnection}>
          <button className="text-xs text-gray-400 hover:text-red-500">연결 해제</button>
        </form>
      </div>

      {synced != null && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          받은편지함 확인 완료 — 새 답장 {synced}건을 지시에 연결했습니다.{" "}
          <Link href="/dashboard" className="underline">대시보드에서 확인 →</Link>
        </div>
      )}
      {error === "gmailsync" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Gmail 연결은 발송 전용이라 받은편지함을 확인하지 않습니다 — 답변은 직답 버튼으로 자동 도착합니다.
        </div>
      )}
      {error === "noconn" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">메일 연결이 없습니다.</div>
      )}

      {connected === "gmail" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Google 계정이 연결됐습니다 — 비밀번호 없이 메일 추적이 시작됩니다.
        </div>
      )}

      {/* capability card — the honest contract for THIS server */}
      {isGmailConn ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Google 연결(OAuth) — 서버는 <b>발송 전용 권한(gmail.send)만</b> 갖습니다:
          Saydog 서버는 회원님의 메일함을 <b>한 글자도 읽을 수 없습니다</b>.
          메일함 조회가 필요하면 아래 <b>브라우저에서 읽기</b>를 쓰세요 — 조회도 서버를 거치지 않습니다.
          답변은 메일 속 직답 버튼으로 자동 도착합니다.
        </div>
      ) : isPop3 ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-900">
          <div className="mb-2 font-semibold">이 서버는 POP3만 지원합니다 — 되는 것과 안 되는 것</div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>✅ 아래 &quot;메일로 맡기기&quot;에서 바로 발송+등록</div>
            <div>✅ 답장 감지 (맡긴 일에 답이 왔는지)</div>
            <div>✅ 받은편지함에서 지시 등록 · 본문 선택 + AI 분해</div>
            <div>❌ 보낸편지함 자동 표시 (POP3 프로토콜 한계)</div>
          </div>
          <div className="mt-3 rounded-md bg-white/70 p-3">
            <b>가장 쉬운 방법</b> — 아래 <b>메일로 맡기기</b>에서 보내면 BCC 없이도 자동 등록됩니다.
            웹메일에서 보낼 때만 <b>숨은참조(BCC)에 {conn.email}</b>을 넣어 여기서 등록하세요.
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          IMAP 연결 — 전체 기능 사용 중: 바로 발송+등록 · 보낸편지함 자동 표시 · 답장 감지 · 본문 선택 등록
        </div>
      )}

      {/* Option B — compose here, the SAY is born tracked */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">✉️ 메일로 맡기기</h2>
          <span className="text-xs text-gray-400">{conn.email} 명의로 발송 · 보낸 즉시 지시로 등록</span>
        </div>
        {smtpSaved === "saved" && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            보내기(SMTP) 설정을 저장했습니다. 다시 보내보세요.
          </div>
        )}
        {/* SMTP endpoint editor — auto-open when a send just failed (not for Gmail OAuth) */}
        {!isGmailConn && (
        <details open={error === "send"} className="mb-3 rounded-md border border-gray-100 p-3">
          <summary className="cursor-pointer text-xs text-gray-500">
            ⚙ 보내기(SMTP) 설정 — 현재: {conn.smtpHost ?? `${deriveSmtp(conn.host).host} (자동)`}
            {" : "}{conn.smtpPort ?? `${deriveSmtp(conn.host).port} (자동)`}
          </summary>
          <form action={updateSmtpSettings} className="mt-3 flex items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-medium">SMTP 서버</span>
              <input name="smtpHost" defaultValue={conn.smtpHost ?? deriveSmtp(conn.host).host} className="input mt-1 w-full" />
            </label>
            <label className="block w-24">
              <span className="text-xs font-medium">포트</span>
              <input name="smtpPort" type="number" defaultValue={conn.smtpPort ?? deriveSmtp(conn.host).port} className="input mt-1 w-full" />
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap pb-2.5 text-xs text-gray-600">
              <input type="checkbox" name="allowSelfSigned" defaultChecked={conn.smtpAllowSelfSigned} className="h-3.5 w-3.5 accent-indigo-600" />
              자체서명 인증서 허용
            </label>
            <button className="btn px-3 py-2 text-xs">저장</button>
          </form>
          <p className="mt-2 text-xs text-gray-400">
            회사 서버는 보통 465(SSL) 또는 587 — 방화벽에서 그 포트도 외부에 열려 있어야 합니다. 비밀번호는 다시 입력할 필요 없습니다.
            &quot;자체서명 인증서 허용&quot;은 사내 서버가 정식 SSL 인증서 없이 운영될 때만 켜세요.
          </p>
        </details>
        )}
        {error === "send" && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {why === "auth" && "메일 서버가 로그인(SMTP 인증)을 거부했습니다. 아이디(전체 주소·짧은 아이디 모두 자동 시도됨)·비밀번호를 확인하고, 사내 서버라면 메일서버 관리자 화면의 [계정 보안 관리]에서 이 계정의 SMTP 인증이 허용돼 있는지 확인하세요."}
            {why === "cert" && "서버의 SSL 인증서를 신뢰할 수 없습니다(자체서명 등) — 사내 서버에서 흔합니다. 위의 ⚙ 설정에서 \"자체서명 인증서 허용\"을 켜고 다시 보내세요."}
            {why === "timeout" && "보내기 서버가 응답하지 않습니다. 위의 ⚙ 보내기(SMTP) 설정에서 포트를 465 또는 587로 바꾸고, 그 포트가 방화벽에 열려 있는지 확인하세요."}
            {why === "refused" && "보내기 서버가 이 포트를 거부했습니다. 위의 ⚙ 보내기(SMTP) 설정에서 포트를 465 또는 587로 바꿔보세요."}
            {(why === "dns" || why === "other" || !why) && "메일 발송에 실패했습니다. 위의 ⚙ 보내기(SMTP) 설정을 확인해주세요."}
            {" "}(작성한 내용은 그대로 남아 있습니다)
            {detail && (
              <div className="mt-2 rounded bg-white/70 px-2 py-1 font-mono text-xs text-red-500">
                서버 응답: {detail}
              </div>
            )}
          </div>
        )}
        {error === "compose_missing" && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            받는 사람과 제목을 입력해주세요.
          </div>
        )}
        <form action={composeAndSend} className="space-y-3">
          <RecipientInput recent={recentCounterparties} defaultValue={prevTo ?? ""} />
          <input
            name="subject" placeholder="제목 — 맡기는 일이 한 줄로 드러나게" defaultValue={prevSubject ?? ""}
            className="input w-full" required
          />
          <textarea
            name="body" rows={4} defaultValue={prevBody ?? ""}
            placeholder="내용 (선택) — 적으면 AI가 꼭지로 분해해 추적합니다"
            className="input w-full"
          />
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input type="checkbox" name="individual" defaultChecked className="mt-0.5 h-3.5 w-3.5 accent-indigo-600" />
            <span>
              <b>받는 사람마다 개별 발송·개별 추적</b> — 여러 명이면 각자에게 따로 보내고,
              한 명 한 명의 답장을 따로 기다립니다 (서로의 주소는 안 보임). 끄면 한 스레드로 묶어 아무나 답하면 됩니다.
            </span>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              상대는 평범한 메일을 받습니다 · 답장하면 자동으로 이행(DO) 기록
            </span>
            <PendingButton pendingLabel="발송 중…" className="btn px-4 py-2 text-sm">
              보내고 지시로 등록
            </PendingButton>
          </div>
        </form>
      </div>

      {isGmailConn ? (
        <LocalGmail
          clientId={process.env.GOOGLE_MAIL_CLIENT_ID ?? ""}
          tracked={gmailTracked}
          registered={gmailTracked.map((t) => t.msgId)}
        />
      ) : (
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          이 화면을 열 때만 메일함을 읽습니다 · 기본은 메타데이터만 저장
        </span>
        <div className="flex items-center gap-2">
          <Link href="/mail?list=1" className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            {wantList ? "🔃 목록 새로고침" : "📥 메일 불러오기"}
          </Link>
          <form action={syncReplies}>
            <PendingButton pendingLabel="받은편지함 확인 중…" className="btn px-3 py-1.5 text-sm">
              🔄 답장 확인
            </PendingButton>
          </form>
        </div>
      </div>
      )}

      {fetchError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          메일함 읽기 실패: {fetchError}
        </div>
      )}

      {!isGmailConn && (
      <div className="card divide-y divide-gray-100 p-0">
        {!wantList && !fetchError && (
          <Link href="/mail?list=1" className="block p-4 text-sm text-gray-400 hover:bg-gray-50">
            📥 <span className="text-indigo-600 underline">메일 불러오기</span>를 누르면 {isPop3 ? "받은편지함" : "보낸 메일"}을
            읽어옵니다 (누를 때만 메일함에 접속 · 제목/상대/날짜만).
          </Link>
        )}
        {wantList && mails.length === 0 && !fetchError && (
          <div className="p-4 text-sm text-gray-400">최근 보낸 메일이 없습니다.</div>
        )}
        {mails.map((m) => {
          const msgId = normalizeMessageId(m.messageId);
          const reg = byMsgId.get(msgId);
          const to = (m.to ?? []).join(", ");
          return (
            <div key={`${m.mailbox}-${m.seq}`} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.subject ?? "(제목 없음)"}</div>
                <div className="truncate text-xs text-gray-400">
                  {m.date?.slice(0, 10)} · → {to || "?"}
                </div>
              </div>
              {reg && reg.length > 0 ? (
                (() => {
                  const replied = reg.filter((r) => r.replyReceivedAt).length;
                  const all = reg.length;
                  const done = replied === all;
                  return (
                    <Link
                      href={all === 1 ? `/instructions/${reg[0].id}` : "/dashboard"}
                      className={`badge shrink-0 ${replied > 0 ? "bg-emerald-100 text-emerald-700" : "bg-indigo-50 text-indigo-600"}`}
                    >
                      {all === 1
                        ? (done ? "✉ 답장 도착" : "등록됨 · 답장 대기")
                        : `✉ 답장 ${replied}/${all}`}
                    </Link>
                  );
                })()
              ) : (
                <div className="flex shrink-0 gap-1">
                  <form action={registerMailAsSay}>
                    <input type="hidden" name="messageId" value={m.messageId} />
                    <input type="hidden" name="subject" value={m.subject ?? ""} />
                    <input type="hidden" name="to" value={to} />
                    <input type="hidden" name="mailbox" value={m.mailbox} />
                    <input type="hidden" name="seq" value={m.seq} />
                    <input type="hidden" name="uid" value={m.uid ?? ""} />
                    <button className="btn px-2 py-1 text-xs" title="제목·받는사람만 저장">지시로 등록</button>
                  </form>
                  {!isGmailConn && (
                  <form action={registerMailAsSay}>
                    <input type="hidden" name="messageId" value={m.messageId} />
                    <input type="hidden" name="subject" value={m.subject ?? ""} />
                    <input type="hidden" name="to" value={to} />
                    <input type="hidden" name="mailbox" value={m.mailbox} />
                    <input type="hidden" name="seq" value={m.seq} />
                    <input type="hidden" name="uid" value={m.uid ?? ""} />
                    <input type="hidden" name="withBody" value="1" />
                    <button
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                      title="이 메일만 본문을 저장하고 AI가 꼭지로 분해합니다"
                    >
                      +본문
                    </button>
                  </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
