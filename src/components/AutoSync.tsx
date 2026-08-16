"use client";

// 앱이 열리거나(마운트) 잠에서 깨어날 때(탭 포커스 복귀) 답장을 조용히
// 확인한다 — 버튼을 누르지 않아도 대시보드 배지가 최신이 되도록.
// 5분 스로틀: 탭 전환마다 메일서버를 두드리지 않는다.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { autoSyncReplies } from "@/app/actions/mail";

const THROTTLE_MS = 5 * 60 * 1000;
const KEY = "fd-autosync-at";

export default function AutoSync() {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    async function run() {
      if (busy.current) return;
      const last = Number(localStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < THROTTLE_MS) return;
      busy.current = true;
      localStorage.setItem(KEY, String(Date.now())); // 실패해도 스로틀은 유지
      try {
        const { matched } = await autoSyncReplies();
        if (matched > 0) router.refresh(); // 새 답장 → 배지·목록 즉시 갱신
      } catch { /* 자동 경로는 조용히 실패한다 */ }
      busy.current = false;
    }

    void run(); // 앱을 연 순간
    const onWake = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [router]);

  return null;
}
