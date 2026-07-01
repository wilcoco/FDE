"use client";

import { useActionState } from "react";
import { resetPassword, type FormState } from "@/app/actions/reset";

const initial: FormState = {};

export default function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label">새 비밀번호</label>
        <input name="password" type="password" className="input" placeholder="6자 이상" required />
      </div>
      <div>
        <label className="label">새 비밀번호 확인</label>
        <input name="confirm" type="password" className="input" placeholder="다시 입력" required />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>
        {pending ? "변경 중…" : "비밀번호 변경하고 로그인"}
      </button>
    </form>
  );
}
