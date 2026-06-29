"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Textarea + optional browser voice dictation (Web Speech API). Voice is just an
 * input adapter onto the text field — if the browser doesn't support it, the
 * textarea still works. No external STT dependency for the MVP.
 */
export default function VoiceCapture({
  name,
  placeholder,
}: {
  name: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<unknown>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const toggle = () => {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      (recRef.current as { stop: () => void } | null)?.stop();
      return;
    }
    const rec = new Ctor() as {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void; start: () => void; stop: () => void;
    };
    rec.lang = "ko-KR";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = 0; i < e.results.length; i++) chunk += e.results[i][0].transcript;
      setText((prev) => (prev ? prev + " " : "") + chunk);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">대표 지시</label>
        {supported && (
          <button
            type="button"
            onClick={toggle}
            className={`text-xs ${listening ? "btn-danger" : "btn-ghost"} px-2 py-1`}
          >
            {listening ? "● 녹음 중… 중지" : "🎤 음성으로 말하기"}
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
      {!supported && <p className="mt-1 text-xs text-gray-400">이 브라우저는 음성 입력을 지원하지 않습니다 — 텍스트로 입력하세요.</p>}
    </div>
  );
}
