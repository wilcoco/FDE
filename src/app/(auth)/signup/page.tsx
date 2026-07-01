import Link from "next/link";
import SignupTabs from "@/components/SignupTabs";
import SocialButtons from "@/components/SocialButtons";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">시작하기</h1>
        <p className="mt-1 text-sm text-gray-500">새 회사를 만들거나 기존 회사에 가입을 요청하세요.</p>
        <div className="mt-5 space-y-4">
          <SocialButtons />
          <SignupTabs />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        이미 계정이 있나요? <Link href="/login" className="text-indigo-600">로그인</Link>
      </p>
    </main>
  );
}
