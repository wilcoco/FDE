"use client";

import { useActionState } from "react";
import { acceptInvitation, type FormState } from "@/app/actions/invitations";

const initial: FormState = {};

export default function InviteAccept({
  token,
  companyName,
  email,
  role,
}: {
  token: string;
  companyName: string;
  email: string;
  role: string;
}) {
  const [state, action, pending] = useActionState(acceptInvitation, initial);
  return (
    <div className="card">
      <h1 className="text-lg font-semibold">{companyName} 합류</h1>
      <p className="mt-1 text-sm text-gray-500">
        <b>{email}</b> 계정으로 초대받았습니다 (역할: {role}). 이름과 비밀번호를 설정하세요.
      </p>
      <form action={action} className="mt-5 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label">이름</label>
          <input name="name" className="input" placeholder="홍길동" required />
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
