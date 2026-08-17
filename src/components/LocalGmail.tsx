"use client";

// 브라우저-로컬 Gmail 읽기 — 카드 ②' 아키텍처의 클라이언트.
// 액세스 토큰은 이 컴포넌트의 ref에만 머물고(저장소·서버 전송 없음), Gmail
// API 호출도 전부 이 브라우저에서 직접 나간다. 서버로 가는 것은 사용자가
// 버튼으로 고른 결과뿐: [지시로 등록](+선택한 본문), [답장 도착 기록].

import { useEffect, useRef, useState } from "react";
import { registerLocalMail, markLocalReply } from "@/app/actions/local-mail";
import {
  toEnvelope, extractPlainText, matchReplies,
  type GmailMessage, type LocalEnvelope,
} from "@/lib/gmail-local";
import { harvestAddresses } from "@/lib/address-book";

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const META = "format=metadata&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc";

interface TokenClient { requestAccessToken: (cfg?: { prompt?: string }) => void }
interface GsiOauth2 {
  initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (r: { access_token?: string; error?: string }) => void;
  }) => TokenClient;
}
declare global {
  interface Window { google?: { accounts?: { oauth2?: GsiOauth2 } } }
}

export interface TrackedSay { msgId: string; instructionId: string; replied: boolean }

function loadGis(): Promise<GsiOauth2> {
  return new Promise((resolve, reject) => {
    const ready = () => window.google?.accounts?.oauth2;
    const have = ready();
    if (have) return resolve(have);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const g = ready();
      if (g) resolve(g);
      else reject(new Error("Google 스크립트를 불러오지 못했습니다"));
    };
    s.onerror = () => reject(new Error("Google 스크립트를 불러오지 못했습니다 (네트워크/차단)"));
    document.head.appendChild(s);
  });
}

export default function LocalGmail({
  clientId, tracked, registered, selfEmail,
}: {
  clientId: string;
  tracked: TrackedSay[];
  registered: string[];
  selfEmail: string;
}) {
  const tokenRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<LocalEnvelope[]>([]);
  const [replies, setReplies] = useState<{ env: LocalEnvelope; instructionId: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // row id being submitted
  const registeredSet = new Set(registered);

  async function gmailGet(path: string): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status} — ${(await res.text()).slice(0, 120)}`);
    return res.json();
  }

  async function listLabel(label: "SENT" | "INBOX", n: number): Promise<LocalEnvelope[]> {
    const list = (await gmailGet(`/messages?labelIds=${label}&maxResults=${n}`)) as { messages?: { id: string }[] };
    const metas = await Promise.all(
      (list.messages ?? []).map((m) => gmailGet(`/messages/${m.id}?${META}`) as Promise<GmailMessage>),
    );
    return metas.map(toEnvelope);
  }

  async function refresh() {
    setPhase("loading");
    setError(null);
    try {
      const [sentEnvs, inboxEnvs] = await Promise.all([listLabel("SENT", 15), listLabel("INBOX", 25)]);
      setSent(sentEnvs);
      setReplies(matchReplies(inboxEnvs, tracked, selfEmail));
      // 수신자 명단 수확 — 이 브라우저의 localStorage에만 쌓여 /capture 추천 칩이 된다
      harvestAddresses(sentEnvs.flatMap((e) => e.to), selfEmail);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "메일을 읽지 못했습니다");
      setPhase("idle");
    }
  }

  async function connect(silent = false) {
    if (!silent) setError(null);
    try {
      const oauth2 = await loadGis();
      let settled = false;
      const tc = oauth2.initTokenClient({
        client_id: clientId,
        scope: READ_SCOPE,
        callback: (resp) => {
          settled = true;
          if (resp.access_token) {
            tokenRef.current = resp.access_token; // memory only — never persisted, never sent to our server
            localStorage.setItem("fd-gmail-linked", "1"); // 다음에 깨어날 때 무팝업 재시도의 근거
            void refresh();
          } else if (!silent) {
            setError(resp.error ?? "권한이 승인되지 않았습니다");
          }
        },
      });
      // silent: 이전 승인이 있으면 UI 없이 토큰이 온다. 팝업이 필요해지면
      // 차단되어 콜백이 안 올 수 있으니 5초 후 조용히 포기(버튼 경로로).
      tc.requestAccessToken(silent ? { prompt: "" } : undefined);
      if (silent) setTimeout(() => { if (!settled) { /* idle 유지 */ } }, 5000);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "연결 실패");
    }
  }

  // 앱이 열리거나 탭이 깨어날 때 스스로 갱신 — 토큰이 살아 있으면 목록만
  // 다시 읽고, 이전에 연결한 적 있으면 무팝업으로 토큰을 재시도한다.
  const wakeAt = useRef(0);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - wakeAt.current < 2 * 60 * 1000) return; // 2분 스로틀
      wakeAt.current = Date.now();
      if (tokenRef.current) void refresh();
      else if (localStorage.getItem("fd-gmail-linked")) void connect(true);
    };
    wake(); // 마운트 = 화면을 연 순간
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function register(env: LocalEnvelope, withBody: boolean) {
    setBusy(env.id + (withBody ? "b" : ""));
    try {
      let body = "";
      if (withBody) {
        const full = (await gmailGet(`/messages/${env.id}?format=full`)) as GmailMessage;
        body = extractPlainText(full.payload).slice(0, 20_000);
      }
      const fd = new FormData();
      fd.set("messageId", env.messageId);
      fd.set("subject", env.subject);
      fd.set("to", env.to.join(", "));
      fd.set("body", body);
      await registerLocalMail(fd); // redirects on success
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "등록 실패");
    }
  }

  async function recordReply(m: { env: LocalEnvelope; instructionId: string }) {
    setBusy(`r-${m.instructionId}`);
    try {
      // 기록을 누른 그 답장의 본문을 브라우저가 읽어 함께 올린다 — 지시
      // 페이지에서 수행 내용을 바로 볼 수 있게 (클릭한 메일만, best-effort)
      let body = "";
      try {
        const full = (await gmailGet(`/messages/${m.env.id}?format=full`)) as GmailMessage;
        body = extractPlainText(full.payload).slice(0, 5000);
      } catch { /* 본문 없이도 도착 기록은 진행 */ }
      const fd = new FormData();
      fd.set("instructionId", m.instructionId);
      fd.set("from", m.env.from);
      fd.set("subject", m.env.subject);
      fd.set("date", m.env.date ?? "");
      fd.set("body", body);
      await markLocalReply(fd); // redirects on success
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "기록 실패");
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">🖥️ 브라우저에서 내 Gmail 읽기</h2>
        <span className="text-[11px] text-gray-400">토큰·메일은 이 브라우저에만 · 서버 무경유</span>
      </div>
      <p className="text-xs leading-5 text-gray-500">
        메일함 조회는 사장님의 브라우저가 Google에 직접 요청합니다 — Saydog 서버는 거치지 않습니다.
        아래에서 <b>지시로 등록</b>을 누른 메일의 정리 결과만 장부에 올라갑니다.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
      )}

      {phase !== "ready" && (
        <button
          onClick={() => void connect()}
          disabled={phase === "loading"}
          className="btn w-full py-2.5 text-sm"
        >
          {phase === "loading" ? "메일함 읽는 중…" : "🔐 브라우저에서 메일 불러오기 (Google 승인)"}
        </button>
      )}

      {phase === "ready" && replies.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 text-xs font-semibold text-amber-800">
            📬 기다리던 답장 {replies.length}건이 받은편지함에 있습니다 — 기록할까요?
          </div>
          {replies.map((m) => (
            <div key={m.instructionId} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1 truncate text-xs text-amber-900">
                {m.env.from} · {m.env.subject || "(제목 없음)"}
              </div>
              <button
                onClick={() => void recordReply(m)}
                disabled={busy === `r-${m.instructionId}`}
                className="btn shrink-0 px-2 py-1 text-xs"
              >
                {busy === `r-${m.instructionId}` ? "기록 중…" : "✉ 답장 도착 기록"}
              </button>
            </div>
          ))}
        </div>
      )}

      {phase === "ready" && (
        <div className="divide-y divide-gray-100 rounded-md border border-gray-100">
          {sent.length === 0 && <div className="p-3 text-xs text-gray-400">최근 보낸 메일이 없습니다.</div>}
          {sent.map((env) => (
            <div key={env.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{env.subject || "(제목 없음)"}</div>
                <div className="truncate text-xs text-gray-400">
                  {env.date?.slice(0, 10)} · → {env.to.join(", ") || "?"}
                </div>
              </div>
              {registeredSet.has(env.messageId) ? (
                <span className="badge shrink-0 bg-indigo-50 text-indigo-600">등록됨</span>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => void register(env, false)}
                    disabled={busy !== null}
                    className="btn px-2 py-1 text-xs"
                    title="제목·받는사람만 서버에 저장"
                  >
                    {busy === env.id ? "등록 중…" : "지시로 등록"}
                  </button>
                  <button
                    onClick={() => void register(env, true)}
                    disabled={busy !== null}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                    title="이 메일의 본문을 브라우저에서 읽어 함께 올리고 AI가 꼭지로 분해합니다"
                  >
                    {busy === env.id + "b" ? "등록 중…" : "+본문"}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="flex justify-end p-2">
            <button onClick={() => void refresh()} className="text-xs text-gray-400 hover:text-gray-600">
              🔃 새로고침
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
