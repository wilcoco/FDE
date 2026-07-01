import Link from "next/link";
import { prisma } from "@/lib/db";
import ResetForm from "@/components/ResetForm";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  const valid = record && !record.usedAt && record.expiresAt > new Date();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      <div className="card">
        {valid ? (
          <>
            <h1 className="text-lg font-semibold">새 비밀번호 설정</h1>
            <p className="mt-1 text-sm text-gray-500">새 비밀번호를 입력하면 바로 로그인됩니다.</p>
            <div className="mt-5">
              <ResetForm token={token} />
            </div>
          </>
        ) : (
          <div className="text-center">
            <h1 className="text-lg font-semibold">유효하지 않은 링크</h1>
            <p className="mt-2 text-sm text-gray-500">
              링크가 만료되었거나 이미 사용되었습니다. 재설정을 다시 요청하세요.
            </p>
            <Link href="/forgot" className="btn mt-4 inline-block">재설정 다시 요청</Link>
          </div>
        )}
      </div>
    </main>
  );
}
