import Link from "next/link";
import SignupForm from "@/components/SignupForm";
import SocialButtons from "@/components/SocialButtons";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">회사 시작하기</h1>
        <p className="mt-1 text-sm text-gray-500">새 회사(그룹) 계정과 대표 관리자를 만듭니다.</p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          이미 회사가 있고 <b>초대받으셨나요?</b> 이 화면이 아니라 관리자가 보낸 <b>초대 링크</b>로 가입하세요. (여기서는 새 회사가 만들어집니다)
        </p>
        <div className="mt-5 space-y-4">
          <SocialButtons />
          <SignupForm />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        이미 계정이 있나요? <Link href="/login" className="text-indigo-600">로그인</Link>
      </p>
    </main>
  );
}
