import { requireContext } from "@/lib/session";
import { generateAndCreate } from "@/app/actions/process";

const EXAMPLE = `예시) 비품 구매 요청 프로세스:
직원이 비품 구매를 신청한다(품목, 금액 입력). 팀장이 검토하고, 금액이 100만원을 넘으면 본부장 결재도 받는다. 비용 승인이 끝나면 구매 담당자가 발주한다. 발주가 끝나면 신청자에게 완료를 통보한다.`;

export default async function NewProcessPage() {
  await requireContext();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">새 프로세스 만들기</h1>
        <p className="mt-1 text-gray-500">
          업무가 어떻게 진행되는지 자연어로 적어주세요. AI가 프로세스 순서도로 변환합니다.
          (생성 후 자유롭게 편집할 수 있습니다.)
        </p>
      </div>
      <form action={generateAndCreate} className="card space-y-4">
        <div>
          <label className="label">업무 매뉴얼 (자연어)</label>
          <textarea
            name="manual"
            className="input min-h-56 font-mono"
            placeholder={EXAMPLE}
            required
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            결재·승인·비용·분기 등을 자연어로 설명하면 적절한 노드로 변환됩니다.
          </p>
          <button className="btn">AI로 순서도 생성</button>
        </div>
      </form>
    </div>
  );
}
