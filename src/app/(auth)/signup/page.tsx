"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type FormState } from "@/app/actions/auth";

const initial: FormState = {};

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, initial);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">회사 시작하기</h1>
        <p className="mt-1 text-sm text-gray-500">새 회사(그룹) 계정과 대표 관리자를 만듭니다.</p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          이미 회사가 있고 <b>초대받으셨나요?</b> 이 화면이 아니라 관리자가 보낸 <b>초대 링크</b>로 가입하세요. (여기서는 새 회사가 만들어집니다)
        </p>
        <form action={action} className="mt-5 space-y-4">
          <div>
            <label className="label">회사명</label>
            <input name="companyName" className="input" placeholder="예: 아크미 주식회사" required />
          </div>
          <div>
            <label className="label">대표 관리자 이름</label>
            <input name="name" className="input" placeholder="홍길동" required />
          </div>
          <div>
            <label className="label">이메일</label>
            <input name="email" type="email" className="input" placeholder="admin@acme.com" required />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input name="password" type="password" className="input" placeholder="6자 이상" required />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button className="btn w-full" disabled={pending}>
            {pending ? "생성 중…" : "회사 만들기"}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        이미 계정이 있나요? <Link href="/login" className="text-indigo-600">로그인</Link>
      </p>
    </main>
  );
}
