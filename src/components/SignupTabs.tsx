"use client";

import { useState } from "react";
import SignupForm from "@/components/SignupForm";
import JoinExisting from "@/components/JoinExisting";

type Mode = "create" | "join";

export default function SignupTabs() {
  const [mode, setMode] = useState<Mode>("create");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`rounded-md py-1.5 font-medium transition ${
            mode === "create" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
          }`}
        >
          새 회사 만들기
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={`rounded-md py-1.5 font-medium transition ${
            mode === "join" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
          }`}
        >
          기존 회사에 가입
        </button>
      </div>
      {mode === "create" ? (
        <>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            새 회사(그룹)와 대표 관리자 계정을 만듭니다.
          </p>
          <SignupForm />
        </>
      ) : (
        <>
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            이미 있는 회사에 합류를 요청합니다. 관리자가 승인하면 가입됩니다.
          </p>
          <JoinExisting />
        </>
      )}
    </div>
  );
}
