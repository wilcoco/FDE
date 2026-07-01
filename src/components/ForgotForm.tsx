"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type FormState } from "@/app/actions/reset";

const initial: FormState = {};

export default function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  if (state.ok) {
    return (
      <div className="rounded-md bg-green-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-green-800">메일을 보냈습니다.</p>
        <p className="mt-1 text-xs text-green-700">
          입력하신 이메일이 등록되어 있다면 재설정 링크가 도착합니다. 메일함(스팸함 포함)을 확인하세요. 링크는 1시간 유효합니다.
        </p>
        <Link href="/login" className="btn mt-4 inline-block">로그인으로</Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label">이메일</label>
        <input name="email" type="email" className="input" placeholder="you@company.com" required />
      </div>
      <div>
        <label className="label">회사명 또는 식별자 <span className="text-gray-400">(선택)</span></label>
        <input name="slug" className="input" placeholder="여러 회사에 같은 이메일일 때만" />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>
        {pending ? "보내는 중…" : "재설정 링크 받기"}
      </button>
    </form>
  );
}
