import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadMailConn } from "@/lib/mail-conn";
import { listRecentSent, protocolFor, type ListedMail } from "@/lib/mail-fetch";
import {
  saveMailConnection, deleteMailConnection, registerMailAsSay, syncReplies,
} from "@/app/actions/mail";
import { normalizeMessageId } from "@/lib/inbound-email";
import PendingButton from "@/components/PendingButton";

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
    error?: string; synced?: string; why?: string;
    host?: string; port?: string; email?: string; login?: string; // echoed back on failure
  }>;
}) {
  const { tenant, user } = await requireContext();
  const { error, synced, why, host: prevHost, port: prevPort, email: prevEmail, login: prevLogin } = await searchParams;
  const conn = await loadMailConn(user.id);

  // ── not connected yet: setup ──
  if (!conn) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">📧 메일 연결</h1>
          <p className="mt-1 text-sm text-gray-500">
            내 메일함에서 보낸 메일을 불러와 지시로 등록하고, 답장이 왔는지 추적합니다.
          </p>
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
            모든 항목을 입력해주세요.
          </div>
        )}

        <form action={saveMailConnection} className="card space-y-4">
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="block">
              <span className="text-sm font-medium">IMAP 서버</span>
              <input name="host" placeholder="imap.naver.com" defaultValue={prevHost ?? ""} className="input mt-1 w-full" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium">포트</span>
              <input name="port" type="number" defaultValue={prevPort ?? 993} className="input mt-1 w-full" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">이메일 주소</span>
            <input name="email" type="email" placeholder="me@naver.com" defaultValue={prevEmail ?? ""} className="input mt-1 w-full" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium">
              로그인 아이디 <span className="font-normal text-gray-400">(이메일 주소와 다를 때만)</span>
            </span>
            <input name="loginUser" placeholder="예: json — 비워두면 이메일 주소로 로그인" defaultValue={prevLogin ?? ""} className="input mt-1 w-full" />
            <span className="mt-1 block text-xs text-gray-400">
              사내 메일서버는 주소(json@회사.co.kr)가 아니라 아이디(json)로 로그인하는 경우가 많습니다.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">앱 비밀번호</span>
            <input name="password" type="password" className="input mt-1 w-full" required />
            <span className="mt-1 block text-xs text-gray-400">
              메일 서비스의 [환경설정 → IMAP/POP → 앱 비밀번호]에서 발급한 비밀번호를 쓰세요.
              (네이버: imap.naver.com · 다음: imap.daum.net · 구글: imap.gmail.com — 구글은 2단계 인증 후 앱 비밀번호 필요)
            </span>
          </label>
          <PendingButton pendingLabel="연결 확인 중… (최대 10초)">연결하기</PendingButton>
        </form>
      </div>
    );
  }

  // ── connected: fetch mail NOW (because the user opened this screen) ──
  const isPop3 = protocolFor(conn.port) === "pop3";
  let mails: ListedMail[] = [];
  let fetchError: string | null = null;
  try {
    mails = await listRecentSent(conn, 20);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "메일함을 읽지 못했습니다";
  }

  // mark rows already registered
  const ids = mails.map((m) => normalizeMessageId(m.messageId)).filter(Boolean);
  const existing = ids.length
    ? await prisma.instruction.findMany({
        where: { tenantId: tenant.id, threadMessageId: { in: ids } },
        select: { id: true, threadMessageId: true, replyReceivedAt: true },
      })
    : [];
  const byMsgId = new Map(existing.map((r) => [r.threadMessageId!, r]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">📧 메일 → 지시</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isPop3
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
      {error === "noconn" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">메일 연결이 없습니다.</div>
      )}

      {isPop3 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-800">
          <b>POP3 모드</b> — 이 서버는 받은편지함만 읽을 수 있습니다. 맡기는 메일을 여기서 등록하려면{" "}
          <b>보낼 때 숨은참조(BCC)에 {conn.email}</b>을 넣으세요. 그러면 그 메일이 아래 목록에 떠서
          지시로 등록할 수 있고, 상대 답장도 자동으로 잡힙니다.
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          이 화면을 열 때만 메일함을 읽습니다 · 기본은 메타데이터만 저장
        </span>
        <form action={syncReplies}>
          <PendingButton pendingLabel="받은편지함 확인 중…" className="btn px-3 py-1.5 text-sm">
            🔄 답장 확인
          </PendingButton>
        </form>
      </div>

      {fetchError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          메일함 읽기 실패: {fetchError}
        </div>
      )}

      <div className="card divide-y divide-gray-100 p-0">
        {mails.length === 0 && !fetchError && (
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
              {reg ? (
                <Link
                  href={`/instructions/${reg.id}`}
                  className={`badge shrink-0 ${reg.replyReceivedAt ? "bg-emerald-100 text-emerald-700" : "bg-indigo-50 text-indigo-600"}`}
                >
                  {reg.replyReceivedAt ? "✉ 답장 도착" : "등록됨 · 답장 대기"}
                </Link>
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
