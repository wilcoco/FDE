import Link from "next/link";
import { cookies } from "next/headers";
import { verifyPending } from "@/lib/social";
import CompleteForm from "@/components/CompleteForm";

export default async function CompletePage() {
  const store = await cookies();
  const token = store.get("fd_pending")?.value;
  const pending = token ? await verifyPending(token) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-xl font-bold text-indigo-600">FlowDesk</Link>
      {!pending ? (
        <div className="card text-center">
          <h1 className="text-lg font-semibold">가입 세션이 만료되었습니다</h1>
          <p className="mt-2 text-sm text-gray-500">다시 소셜 로그인으로 시작해 주세요.</p>
          <Link href="/login" className="btn mt-4 inline-block">로그인으로</Link>
        </div>
      ) : (
        <CompleteForm name={pending.name} email={pending.email} suggested={pending.orgName ?? ""} />
      )}
    </main>
  );
}
