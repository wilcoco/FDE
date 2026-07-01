import Link from "next/link";
import ForgotForm from "@/components/ForgotForm";

export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">비밀번호 재설정</h1>
        <p className="mt-1 text-sm text-gray-500">
          가입한 회사 식별자와 이메일을 입력하면 재설정 링크를 보내드립니다.
        </p>
        <div className="mt-5">
          <ForgotForm />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        생각났나요? <Link href="/login" className="text-indigo-600">로그인</Link>
      </p>
    </main>
  );
}
