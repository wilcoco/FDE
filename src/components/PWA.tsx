"use client";

import { useEffect, useState } from "react";

// Chrome/Edge/Android fire this before showing the install UI.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // register the service worker (required for installability)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setDeferred(null));

    // iOS Safari has no install prompt API — detect & show a manual hint.
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      nav.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !standalone && !localStorage.getItem("fd_ios_hint_dismissed")) {
      setIosHint(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed) return null;

  if (deferred) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-indigo-200 bg-white p-3 shadow-lg md:left-auto md:right-4 md:w-80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
            F
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">FlowDesk 앱 설치</p>
            <p className="text-xs text-gray-500">바탕화면/홈 화면에 추가해 앱처럼 쓰세요.</p>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            className="btn flex-1 py-1.5 text-xs"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            }}
          >
            설치
          </button>
          <button
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => setDismissed(true)}
          >
            나중에
          </button>
        </div>
      </div>
    );
  }

  if (iosHint) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-indigo-200 bg-white p-3 text-sm shadow-lg">
        <div className="flex items-start gap-2">
          <span className="text-lg">📲</span>
          <p className="flex-1 text-gray-700">
            홈 화면에 추가하려면 하단의 <b>공유</b> 버튼 → <b>&ldquo;홈 화면에 추가&rdquo;</b>를 누르세요.
          </p>
          <button
            className="text-xs text-gray-400"
            onClick={() => {
              localStorage.setItem("fd_ios_hint_dismissed", "1");
              setIosHint(false);
            }}
          >
            닫기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
