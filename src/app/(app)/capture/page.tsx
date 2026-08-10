import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { captureInstruction } from "@/app/actions/capture";
import VoiceCapture from "@/components/VoiceCapture";
import SubmitButton from "@/components/SubmitButton";
import { sttConfigured } from "@/lib/stt";

const EXAMPLE = "예: 다음 달 신제품 출시 준비해. 마케팅은 홍보안 잡고, 영업은 주요 거래처 사전 영업 돌리고, 생산은 초도 물량 확보해서 출시일 맞춰줘.";

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { tenant } = await requireContext();
  const { from } = await searchParams;
  const serverStt = sttConfigured();

  // delegation chain: capturing FROM a milestone — my "do" becomes my "say"
  const parent = from
    ? await prisma.milestone.findFirst({
        where: { id: from, tenantId: tenant.id },
        select: {
          id: true, title: true, expectedResult: true,
          instruction: { select: { id: true, summary: true, author: { select: { name: true } } } },
        },
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{parent ? "하위 지시로 분해" : "지시하기"}</h1>
        <p className="mt-1 text-gray-500">
          말하거나 적으면, AI가 *굵직한 꼭지*로 나눠 실행·추적 가능한 형태로 만듭니다.
          상세 실행은 조직이, 대표는 순서와 결과만 관리합니다.
        </p>
      </div>

      {parent && (
        <div className="card border-indigo-200 bg-indigo-50/50">
          <p className="text-xs font-semibold text-indigo-700">⤵ 위임 사슬 — 내가 맡은 꼭지를 내 지시로 나눕니다</p>
          <p className="mt-1 text-sm text-gray-700">
            상위 꼭지: <b>{parent.title}</b>
            <span className="ml-2 text-xs text-gray-400">
              ({parent.instruction.author.name} 지시 ·{" "}
              <Link href={`/instructions/${parent.instruction.id}`} className="text-indigo-600 hover:underline">
                {parent.instruction.summary ?? "상위 지시"}
              </Link>)
            </span>
          </p>
          {parent.expectedResult && (
            <p className="mt-1 text-xs text-gray-500">이 꼭지의 기대 결과: {parent.expectedResult}</p>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            하위 지시의 완료가 상위 꼭지를 자동으로 완료시키지는 않습니다 — 상위 꼭지는 여전히 내가 제출하고 지시자가 확인합니다.
          </p>
        </div>
      )}

      <form action={captureInstruction} className="card space-y-4">
        {parent && <input type="hidden" name="parentMilestoneId" value={parent.id} />}
        <VoiceCapture name="rawText" placeholder={EXAMPLE} serverStt={serverStt} />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">결재·비용·분기 등 자연어로 말하면 AI가 알아서 꼭지로 정리합니다.</p>
          <SubmitButton pendingText="AI가 꼭지 만드는 중…">AI로 꼭지 만들기</SubmitButton>
        </div>
      </form>
    </div>
  );
}
