"use client";

// 지시하기 — 두 갈래 흐름 (일의 전후 원칙의 실행체):
//  · 빠른 보내기: 쓰기 → (AI가 상대 추천·내가 탭 확인) → 즉시 발송/등록.
//    AI는 분해가 아니라 말투 정리만 하고, 원문은 장부에 그대로 남는다.
//  · 다듬어 보내기: 쓰기 → AI 분해 → 꼭지 확정 → 그때 받는 사람 → 발송.
// 받는 사람 후보 = 과거 지시 상대(DB) + 브라우저에서 수확한 메일 수신자
// (localStorage — 메일 파생 데이터는 기기 밖으로 나가지 않는다).

import { useEffect, useRef, useState } from "react";
import VoiceCapture from "./VoiceCapture";
import { previewTasks, finalizeCapture, quickSend } from "@/app/actions/capture";
import { loadAddrBook, topAddresses, suggestFromText } from "@/lib/address-book";

interface Task { title: string; expectedResult: string | null; keep: boolean }

export default function CaptureForm({ serverStt, recent }: { serverStt: boolean; recent: string[] }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState<"" | "quick" | "preview" | "confirm">("");
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chips, setChips] = useState<string[]>(recent);
  const [suggested, setSuggested] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // DB 원장 + 브라우저 수확 주소록 병합 (클라이언트에서만 가능 — localStorage)
  useEffect(() => {
    setChips(topAddresses(loadAddrBook(), recent, 8));
  }, [recent]);

  const toList = to.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const toggleChip = (email: string) => {
    setTo(toList.includes(email) ? toList.filter((e) => e !== email).join(", ") : [...toList, email].join(", "));
  };

  /** 지시문이 바뀔 때마다(디바운스) 상대 추천 — 자동 발송은 없다, 탭 확인이 원칙 */
  function onFormInput() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const txt = String(new FormData(formRef.current ?? undefined).get("rawText") ?? "");
      const matches = suggestFromText(txt, chips);
      setSuggested(matches);
      // 딱 한 명이 매칭되고 아직 아무도 안 골랐으면 미리 채워둔다 (보내기 전 눈으로 확인 가능)
      if (matches.length === 1 && !to.trim()) setTo(matches[0]);
    }, 400);
  }

  function readRawText(): string {
    return String(new FormData(formRef.current ?? undefined).get("rawText") ?? "").trim();
  }

  async function onQuick() {
    const txt = readRawText();
    if (!txt) { setError("지시 내용을 입력해주세요."); return; }
    setBusy("quick"); setError(null);
    const fd = new FormData();
    fd.set("rawText", txt);
    fd.set("to", to);
    await quickSend(fd); // 성공 시 지시 페이지로 redirect
  }

  async function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const txt = String(fd.get("rawText") ?? "").trim();
    if (!txt) { setError("지시 내용을 입력해주세요."); return; }
    setBusy("preview"); setError(null);
    const res = await previewTasks(fd);
    setBusy("");
    if ("error" in res) { setError(res.error); return; }
    setRawText(txt);
    setSummary(res.summary);
    setTasks(res.tasks.map((t) => ({ ...t, keep: true })));
    setStep(2);
  }

  async function onConfirm() {
    const kept = tasks.filter((t) => t.keep && t.title.trim());
    if (kept.length === 0) { setError("최소 한 개 항목은 남겨야 합니다."); return; }
    setBusy("confirm"); setError(null);
    const fd = new FormData();
    fd.set("rawText", rawText);
    fd.set("to", to);
    fd.set("summary", summary);
    fd.set("tasksJson", JSON.stringify(kept.map(({ title, expectedResult }) => ({ title, expectedResult }))));
    await finalizeCapture(fd); // redirects on success
  }

  const chipRow = (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((email) => (
        <button
          key={email}
          type="button"
          onClick={() => toggleChip(email)}
          className={`rounded-full border px-2 py-0.5 text-xs transition ${
            toList.includes(email)
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : suggested.includes(email)
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-gray-200 text-gray-500 hover:bg-gray-50"
          }`}
        >
          {toList.includes(email) ? "✓ " : suggested.includes(email) ? "🤖 " : "+ "}{email}
        </button>
      ))}
    </div>
  );

  const recipientBlock = (label: string) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <input
        name="to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="받는 사람 이메일 (쉼표로 여러 명) — 비우면 사내 지시"
        className="input mt-1 w-full"
      />
      {chips.length > 0 && <div className="mt-1.5">{chipRow}</div>}
      {suggested.length > 0 && (
        <span className="mt-1 block text-[11px] text-amber-600">
          🤖 지시문에서 상대를 찾았습니다 — 맞는지 확인 후 보내세요.
        </span>
      )}
    </label>
  );

  if (step === 1) {
    return (
      <form ref={formRef} onSubmit={onPreview} onInput={onFormInput} className="card space-y-4">
        <VoiceCapture name="rawText" defaultValue={rawText} serverStt={serverStt}
          placeholder="예: 다음 달 신제품 출시 준비해. 마케팅은 홍보안 잡고, 영업은 주요 거래처 사전 영업 돌리고, 생산은 초도 물량 확보해서 출시일 맞춰줘." />
        {recipientBlock("받는 사람 (선택 · 과거 상대는 칩으로)")}
        {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void onQuick()}
            disabled={busy !== ""}
            className="btn px-4 py-2 text-sm"
          >
            {busy === "quick"
              ? (toList.length ? "AI가 다듬어 보내는 중…" : "등록 중…")
              : toList.length ? "✉ 바로 보내기 (AI가 메일 다듬음)" : "바로 등록"}
          </button>
          <button disabled={busy !== ""} className="rounded-md border border-indigo-200 px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50">
            {busy === "preview" ? "AI가 꼭지 나누는 중…" : "🧩 꼭지 나누어 다듬기 →"}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          간단한 지시는 바로, 복잡한 지시는 꼭지로 나눠 다듬은 뒤 — 받는 사람은 그때 확정해도 됩니다.
          어느 쪽이든 발송 전엔 아무것도 나가지 않습니다.
        </p>
      </form>
    );
  }

  const keptCount = tasks.filter((t) => t.keep && t.title.trim()).length;
  return (
    <div className="card space-y-4">
      <div>
        <p className="text-xs font-semibold text-indigo-600">2단계 — 꼭지 확정 (아직 아무것도 발송되지 않았습니다)</p>
        <label className="mt-2 block">
          <span className="text-xs font-medium text-gray-600">{toList.length ? "메일 제목 (= 지시 요약)" : "지시 요약"}</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} className="input mt-1 w-full" />
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium text-gray-600">요청 항목 — 체크 해제하면 빠지고, 제목은 바로 고칠 수 있습니다</span>
        {tasks.map((t, i) => (
          <div key={i} className={`flex items-start gap-2 rounded-md border p-2 ${t.keep ? "border-gray-200" : "border-gray-100 bg-gray-50 opacity-60"}`}>
            <input type="checkbox" checked={t.keep} className="mt-2 h-4 w-4 accent-indigo-600"
              onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
            <div className="min-w-0 flex-1">
              <input value={t.title} disabled={!t.keep} className="input w-full py-1.5 text-sm"
                onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              {t.expectedResult && <p className="mt-0.5 pl-1 text-[11px] text-gray-400">기대 결과: {t.expectedResult}</p>}
            </div>
          </div>
        ))}
        <button type="button" className="text-xs text-indigo-600 hover:underline"
          onClick={() => setTasks([...tasks, { title: "", expectedResult: null, keep: true }])}>
          ＋ 항목 직접 추가
        </button>
      </div>

      {/* 일의 전후: 구조가 확정된 지금이 받는 사람을 정할 때다 */}
      {recipientBlock("받는 사람 — 확정된 항목을 누구에게 보낼까요? (선택)")}

      {toList.length > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
          받는 사람: <b>{toList.join(", ")}</b> — 위 {keptCount}개 항목이 메일 본문과 직답 페이지에 그대로 실립니다.
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { setStep(1); setError(null); }} className="text-sm text-gray-500 hover:text-gray-700">
          ← 다시 쓰기
        </button>
        <button onClick={() => void onConfirm()} disabled={busy !== "" || keptCount === 0} className="btn px-4 py-2 text-sm">
          {busy === "confirm"
            ? (toList.length ? "발송 중…" : "등록 중…")
            : toList.length ? `✉ ${keptCount}개 항목으로 보내고 등록` : `${keptCount}개 항목으로 등록`}
        </button>
      </div>
    </div>
  );
}
