import { requireContext } from "@/lib/session";
import { captureInstruction } from "@/app/actions/capture";
import VoiceCapture from "@/components/VoiceCapture";
import { sttConfigured } from "@/lib/stt";

const EXAMPLE = "예: 다음 달 신제품 출시 준비해. 마케팅은 홍보안 잡고, 영업은 주요 거래처 사전 영업 돌리고, 생산은 초도 물량 확보해서 출시일 맞춰줘.";

export default async function CapturePage() {
  await requireContext();
  const serverStt = sttConfigured();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">지시하기</h1>
        <p className="mt-1 text-gray-500">
          말하거나 적으면, AI가 *굵직한 꼭지*로 나눠 실행·추적 가능한 형태로 만듭니다.
          상세 실행은 조직이, 대표는 순서와 결과만 관리합니다.
        </p>
      </div>
      <form action={captureInstruction} className="card space-y-4">
        <VoiceCapture name="rawText" placeholder={EXAMPLE} serverStt={serverStt} />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">결재·비용·분기 등 자연어로 말하면 AI가 알아서 꼭지로 정리합니다.</p>
          <button className="btn">AI로 꼭지 만들기</button>
        </div>
      </form>
    </div>
  );
}
