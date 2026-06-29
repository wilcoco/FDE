"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Textarea with two voice paths:
 *  - serverStt=true  → record audio (MediaRecorder) → upload to /api/stt for
 *    high-accuracy transcription (e.g. Whisper). Best quality.
 *  - serverStt=false → browser Web Speech live dictation (zero-config fallback).
 * Either way it's just an input adapter onto the text field; typing always works.
 */
export default function VoiceCapture({
  name,
  placeholder,
  serverStt = false,
}: {
  name: string;
  placeholder?: string;
  serverStt?: boolean;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [webSpeechOk, setWebSpeechOk] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRef = useRef<unknown>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setWebSpeechOk(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // ── high-accuracy: record → /api/stt ──────────────────────────────────────
  const pickMime = () => {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const c of cands) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    return "";
  };

  const startRecord = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await upload(blob);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setErr("마이크 접근에 실패했습니다.");
    }
  };

  const stopRecord = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const upload = async (blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      const fd = new FormData();
      fd.append("audio", blob, `voice.${ext}`);
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "변환 실패");
      if (json.text) setText((prev) => (prev ? prev + " " : "") + json.text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "변환 실패");
    } finally {
      setBusy(false);
    }
  };

  // ── fallback: browser Web Speech live dictation ───────────────────────────
  const toggleWebSpeech = () => {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (recording) { (speechRef.current as { stop: () => void } | null)?.stop(); return; }
    const rec = new Ctor() as {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void; start: () => void; stop: () => void;
    };
    rec.lang = "ko-KR"; rec.interimResults = false; rec.continuous = true;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = 0; i < e.results.length; i++) chunk += e.results[i][0].transcript;
      setText((prev) => (prev ? prev + " " : "") + chunk);
    };
    rec.onend = () => setRecording(false);
    speechRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const showButton = serverStt || webSpeechOk;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">대표 지시</label>
        {showButton && (
          <button
            type="button"
            disabled={busy}
            onClick={serverStt ? (recording ? stopRecord : startRecord) : toggleWebSpeech}
            className={`text-xs px-2 py-1 ${recording ? "btn-danger" : "btn-ghost"} disabled:opacity-50`}
          >
            {busy ? "변환 중…" : recording ? "● 녹음 중… 중지" : serverStt ? "🎙 녹음(고정밀)" : "🎤 음성으로 말하기"}
          </button>
        )}
      </div>
      <textarea
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="input min-h-40"
        placeholder={placeholder}
        required
      />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {!showButton && <p className="mt-1 text-xs text-gray-400">음성 입력 미지원 브라우저 — 텍스트로 입력하세요.</p>}
      {serverStt && <p className="mt-1 text-xs text-gray-400">녹음 후 고정밀 변환(서버). 길게 말해도 됩니다.</p>}
    </div>
  );
}
