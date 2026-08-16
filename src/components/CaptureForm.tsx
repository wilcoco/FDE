"use client";

// 지시하기 2단계 폼 — 일의 전후 원칙의 실행체.
// 1단계: 말하거나 적는다 (+ 받는 사람 이메일 선택 입력)
// 2단계: AI가 나눈 꼭지를 지시자가 빼고(체크 해제) 고치고(제목 수정) 확정
//        → 그때서야 등록·발송된다. 상대는 지시자가 확정한 그 구조를 본다.

import { useState } from "react";
import VoiceCapture from "./VoiceCapture";
import { previewTasks, finalizeCapture } from "@/app/actions/capture";

interface Task { title: string; expectedResult: string | null; keep: boolean }

export default function CaptureForm({ serverStt }: { serverStt: boolean }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);

  async function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const txt = String(fd.get("rawText") ?? "").trim();
    const toVal = String(fd.get("to") ?? "").trim();
    if (!txt) { setError("지시 내용을 입력해주세요."); return; }
    setBusy(true); setError(null);
    const res = await previewTasks(fd);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    setRawText(txt);
    setTo(toVal);
    setSummary(res.summary);
    setTasks(res.tasks.map((t) => ({ ...t, keep: true })));
    setStep(2);
  }

  async function onConfirm() {
    const kept = tasks.filter((t) => t.keep && t.title.trim());
    if (kept.length === 0) { setError("최소 한 개 항목은 남겨야 합니다."); return; }
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("rawText", rawText);
    fd.set("to", to);
    fd.set("summary", summary);
    fd.set("tasksJson", JSON.stringify(kept.map(({ title, expectedResult }) => ({ title, expectedResult }))));
    await finalizeCapture(fd); // redirects to the instruction on success
  }

  if (step === 1) {
    return (
      <form onSubmit={onPreview} className="card space-y-4">
        <VoiceCapture name="rawText" defaultValue={rawText} serverStt={serverStt}
          placeholder="예: 다음 달 신제품 출시 준비해. 마케팅은 홍보안 잡고, 영업은 주요 거래처 사전 영업 돌리고, 생산은 초도 물량 확보해서 출시일 맞춰줘." />
        <label className="block">
          <span className="text-xs font-medium text-gray-600">받는 사람 이메일 (선택 · 쉼표로 여러 명)</span>
          <input name="to" defaultValue={to} placeholder="적으면 확정한 꼭지가 실린 메일이 직답 버튼과 함께 나갑니다"
            className="input mt-1 w-full" />
          <span className="mt-0.5 block text-[11px] text-gray-400">비우면 사내 지시로만 기록됩니다.</span>
        </label>
        {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">다음 단계에서 꼭지를 확인하고 빼거나 고칠 수 있습니다 — 그 전엔 아무것도 나가지 않습니다.</p>
          <button disabled={busy} className="btn px-4 py-2 text-sm">
            {busy ? "AI가 꼭지 나누는 중…" : "꼭지 나누기 →"}
          </button>
        </div>
      </form>
    );
  }

  const keptCount = tasks.filter((t) => t.keep && t.title.trim()).length;
  return (
    <div className="card space-y-4">
      <div>
        <p className="text-xs font-semibold text-indigo-600">2단계 — 꼭지 확정 (아직 아무것도 발송되지 않았습니다)</p>
        <label className="mt-2 block">
          <span className="text-xs font-medium text-gray-600">{to ? "메일 제목 (= 지시 요약)" : "지시 요약"}</span>
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

      {to && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
          받는 사람: <b>{to}</b> — 위 {keptCount}개 항목이 메일 본문과 직답 페이지에 그대로 실립니다.
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { setStep(1); setError(null); }} className="text-sm text-gray-500 hover:text-gray-700">
          ← 다시 쓰기
        </button>
        <button onClick={() => void onConfirm()} disabled={busy || keptCount === 0} className="btn px-4 py-2 text-sm">
          {busy ? (to ? "발송 중…" : "등록 중…") : to ? `✉ ${keptCount}개 항목으로 보내고 등록` : `${keptCount}개 항목으로 등록`}
        </button>
      </div>
    </div>
  );
}
