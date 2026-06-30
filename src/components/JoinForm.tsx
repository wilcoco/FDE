"use client";

import { useActionState } from "react";
import { joinByCodeAction, type FormState } from "@/app/actions/invitations";

const initial: FormState = {};

export default function JoinForm({ code, companyName }: { code: string; companyName: string }) {
  const [state, action, pending] = useActionState(joinByCodeAction, initial);
  return (
    <div className="card">
      <h1 className="text-lg font-semibold">{companyName} 합류</h1>
      <p className="mt-1 text-sm text-gray-500">이름·이메일·비밀번호를 입력하면 이 회사의 구성원으로 가입됩니다.</p>
      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="code" value={code} />
        <div>
          <label className="label">이름</label>
          <input name="name" className="input" placeholder="홍길동" required />
        </div>
        <div>
          <label className="label">이메일</label>
          <input name="email" type="email" className="input" placeholder="you@company.com" required />
        </div>
        <div>
          <label className="label">비밀번호</label>
          <input name="password" type="password" className="input" placeholder="6자 이상" required />
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>
          {pending ? "가입 중…" : "가입하고 시작하기"}
        </button>
      </form>
    </div>
  );
}
