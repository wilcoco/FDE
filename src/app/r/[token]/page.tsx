import { prisma } from "@/lib/db";
import { replyTokenExpired } from "@/lib/reply-token";

export const dynamic = "force-dynamic";

/**
 * 직답 페이지 — 계정 없는 상대방이 메일의 [바로 답변하기] 버튼으로 도착해
 * 답변을 남기는 공개 화면. 토큰 소지가 곧 인증. 로그인 없음, 가입 없음.
 */
export default async function ReplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;

  const inst = await prisma.instruction.findUnique({
    where: { replyToken: token },
    select: {
      summary: true, rawText: true, createdAt: true, replyReceivedAt: true, status: true,
      author: { select: { name: true } },
      tenant: { select: { name: true } },
    },
  });

  if (inst && replyTokenExpired(inst)) {
    return (
      <Shell>
        <h1 className="text-lg font-bold">이 답변 링크는 만료되었습니다</h1>
        <p className="mt-2 text-sm text-gray-500">
          요청이 마감되었거나 링크의 유효기간(90일)이 지났습니다.
          전할 내용이 있다면 {inst.author.name}님께 메일로 직접 회신해주세요.
        </p>
      </Shell>
    );
  }

  if (!inst) {
    return (
      <Shell>
        <h1 className="text-lg font-bold">유효하지 않은 링크입니다</h1>
        <p className="mt-2 text-sm text-gray-500">
          링크가 만료되었거나 잘못 복사되었을 수 있습니다. 요청을 보낸 분에게 다시 확인해주세요.
        </p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="text-3xl">✅</div>
        <h1 className="mt-2 text-lg font-bold">답변이 전달되었습니다</h1>
        <p className="mt-2 text-sm text-gray-500">
          {inst.author.name}님께 바로 전달됐고, 증빙용으로 메일 스레드에도 자동 기록됩니다.
          이 창은 닫으셔도 됩니다. 추가로 전할 내용이 생기면 같은 링크에서 다시 답변할 수 있습니다.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-xs text-gray-400">
        {inst.tenant.name} · {inst.author.name}님의 요청 · {inst.createdAt.toISOString().slice(0, 10)}
      </p>
      <h1 className="mt-1 text-lg font-bold">{inst.summary ?? "요청"}</h1>
      {inst.rawText && inst.rawText !== inst.summary && (
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm leading-6 text-gray-700">
          {inst.rawText.slice(0, 2000)}
        </p>
      )}

      {error === "file" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          첨부는 최대 3개, 파일당 5MB까지 가능합니다.
        </div>
      )}
      {error === "empty" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          답변 내용을 입력해주세요.
        </div>
      )}

      <form action={`/api/reply/${token}`} method="post" encType="multipart/form-data" className="mt-5 space-y-3">
        <input
          name="responder"
          placeholder="성함 (선택)"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <textarea
          name="content"
          rows={6}
          required
          placeholder="답변을 입력하세요 — 보내는 즉시 상대방의 확인함에 기록됩니다."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 focus:border-indigo-500 focus:outline-none"
        />
        <label className="block">
          <span className="text-xs font-medium text-gray-600">첨부파일 (선택 · 최대 3개, 각 5MB)</span>
          <span className="mt-0.5 block text-[11px] text-gray-400">
            사내 보안정책으로 업로드가 막혀 있다면, 답변만 여기서 보내고 파일은 원래 메일에 회신으로 첨부해주세요.
          </span>
          <input
            type="file" name="files" multiple
            className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-600"
          />
        </label>
        <button className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
          답변 보내기
        </button>
      </form>
      <p className="mt-3 text-center text-xs leading-5 text-gray-400">
        가입·로그인 없이 즉시 전달됩니다. 증빙을 위해 답변 내용과 첨부파일은
        원래 메일 스레드에도 자동으로 기록되니, 별도의 메일 회신은 필요 없습니다.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {children}
        <p className="mt-8 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-300">
          Saydog — 맡긴 일이 흐르는지 지켜봅니다
        </p>
      </div>
    </div>
  );
}
