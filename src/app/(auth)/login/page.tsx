import Link from "next/link";
import LoginForm from "@/components/LoginForm";
import SocialButtons from "@/components/SocialButtons";

const ERRORS: Record<string, string> = {
  provider: "지원하지 않거나 설정되지 않은 로그인 방식입니다.",
  denied: "소셜 로그인이 취소되었습니다.",
  state: "보안 검증에 실패했습니다. 다시 시도해 주세요.",
  oauth: "소셜 로그인 처리 중 오류가 발생했습니다.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        <h1 className="text-lg font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-gray-500">소셜 계정 또는 회사 계정으로 로그인하세요.</p>
        {error && ERRORS[error] && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{ERRORS[error]}</p>
        )}
        <div className="mt-5 space-y-4">
          <SocialButtons />
          <LoginForm />
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        회사가 없나요? <Link href="/signup" className="text-indigo-600">회사 시작하기</Link>
      </p>
    </main>
  );
}
