import Link from "next/link";
import { prisma } from "@/lib/db";
import JoinForm from "@/components/JoinForm";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { joinCode: code } });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      {!tenant ? (
        <div className="card text-center">
          <h1 className="text-lg font-semibold">유효하지 않은 가입 링크</h1>
          <p className="mt-2 text-sm text-gray-500">링크가 비활성화되었거나 잘못되었습니다. 관리자에게 새 링크를 요청하세요.</p>
          <Link href="/login" className="btn mt-4 inline-block">로그인</Link>
        </div>
      ) : (
        <JoinForm code={code} companyName={tenant.name} />
      )}
    </main>
  );
}
