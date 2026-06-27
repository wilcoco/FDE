"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type FormState } from "@/app/actions/auth";

const initial: FormState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-gray-500">회사 식별자와 계정으로 로그인하세요.</p>
        <form action={action} className="mt-5 space-y-4">
          <div>
            <label className="label">회사 식별자 (slug)</label>
            <input name="slug" className="input" placeholder="예: acme" required />
          </div>
          <div>
            <label className="label">이메일</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input name="password" type="password" className="input" required />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button className="btn w-full" disabled={pending}>
            {pending ? "로그인 중…" : "로그인"}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        회사가 없나요? <Link href="/signup" className="text-indigo-600">회사 시작하기</Link>
      </p>
    </main>
  );
}
