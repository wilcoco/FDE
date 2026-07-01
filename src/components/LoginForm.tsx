"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/actions/auth";

const initial: FormState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label">이메일</label>
        <input name="email" type="email" className="input" required />
      </div>
      <div>
        <label className="label">회사명 또는 식별자 <span className="text-gray-400">(선택)</span></label>
        <input name="slug" className="input" placeholder="여러 회사에 같은 이메일일 때만 입력" />
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
  );
}
