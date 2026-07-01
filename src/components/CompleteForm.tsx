"use client";

import { useActionState } from "react";
import { completeSocialSignup, type FormState } from "@/app/actions/social";

const initial: FormState = {};

export default function CompleteForm({
  name,
  email,
  suggested,
}: {
  name: string;
  email: string;
  suggested: string;
}) {
  const [state, action, pending] = useActionState(completeSocialSignup, initial);
  return (
    <div className="card">
      <h1 className="text-lg font-semibold">회사 시작하기</h1>
      <p className="mt-1 text-sm text-gray-500">
        {name}님, 환영합니다{email ? ` (${email})` : ""}. 회사 이름만 정하면 바로 시작합니다.
      </p>
      <form action={action} className="mt-5 space-y-4">
        <div>
          <label className="label">회사명</label>
          <input
            name="companyName"
            className="input"
            placeholder="예: 아크미 주식회사"
            defaultValue={suggested}
            required
          />
        </div>
        {suggested && (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            같은 조직({suggested})의 동료가 이후 소셜 로그인하면 이 회사로 자동 합류합니다.
          </p>
        )}
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>
          {pending ? "생성 중…" : "회사 만들고 시작하기"}
        </button>
      </form>
    </div>
  );
}
