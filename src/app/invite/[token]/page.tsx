import Link from "next/link";
import { prisma } from "@/lib/db";
import InviteAccept from "@/components/InviteAccept";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: { tenant: true },
  });

  const invalid = !invite || invite.acceptedAt || invite.expiresAt < new Date();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      {invalid ? (
        <div className="card text-center">
          <h1 className="text-lg font-semibold">유효하지 않은 초대</h1>
          <p className="mt-2 text-sm text-gray-500">
            초대가 만료되었거나 이미 사용되었습니다. 관리자에게 새 초대를 요청하세요.
          </p>
          <Link href="/login" className="btn mt-4 inline-block">로그인</Link>
        </div>
      ) : (
        <InviteAccept
          token={token}
          companyName={invite!.tenant.name}
          email={invite!.email}
          role={invite!.role}
        />
      )}
    </main>
  );
}
