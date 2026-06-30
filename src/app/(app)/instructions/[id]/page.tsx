import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { MilestoneFlow, MilestoneBoard, type MilestoneCard } from "@/components/MilestoneViews";
import {
  updateMilestone, assignMilestoneOwner, setMilestoneStatus, addMilestoneProof,
  addMilestone, deleteMilestone, linkInstructionObjective, archiveInstruction,
  regenerateInstruction,
} from "@/app/actions/capture";
import SubmitButton from "@/components/SubmitButton";

interface ProofItem { type: string; value: string; by: string; at: string }

export default async function InstructionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireContext();
  const inst = await prisma.instruction.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      author: true,
      objective: true,
      milestones: { include: { owner: true }, orderBy: { order: "asc" } },
    },
  });
  if (!inst) notFound();

  const [members, objectives] = await Promise.all([
    prisma.user.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.objective.findMany({ where: { tenantId: tenant.id }, orderBy: { title: "asc" } }),
  ]);

  const cards: MilestoneCard[] = inst.milestones.map((m) => ({
    id: m.id, order: m.order, title: m.title, status: m.status,
    ownerName: m.owner?.name, expectedResult: m.expectedResult,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/instructions" className="text-sm text-gray-400 hover:underline">← 지시 목록</Link>
          <h1 className="mt-1 text-2xl font-bold">{inst.summary || "지시"}</h1>
          <p className="mt-1 text-sm text-gray-500">{inst.author.name} 지시 · {new Date(inst.createdAt).toLocaleString()}</p>
        </div>
        <form action={linkInstructionObjective} className="flex items-center gap-1">
          <input type="hidden" name="id" value={inst.id} />
          <select name="objectiveId" defaultValue={inst.objectiveId ?? ""} className="input py-1 text-xs">
            <option value="">목표 연결</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <button className="btn-ghost text-xs">저장</button>
        </form>
      </div>

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium text-gray-600">원본 지시</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{inst.rawText}</p>
      </details>

      <div className="card">
        <h2 className="mb-3 font-semibold">꼭지 순서 (흐름)</h2>
        <MilestoneFlow milestones={cards} />
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">상태 보드</h2>
        <MilestoneBoard milestones={cards} />
      </div>

      {/* refine: re-guide the AI to regenerate milestones */}
      <details className="card border-indigo-200 bg-indigo-50/40">
        <summary className="cursor-pointer font-semibold text-indigo-800">🔁 AI에게 다시 지침 (꼭지 재생성)</summary>
        <p className="mt-2 text-sm text-gray-500">
          꼭지 구성이 맘에 안 들면, 어떻게 바꿀지 말로 지침을 주세요. AI가 추가 지침을 반영해 꼭지를
          <b> 새로 만듭니다</b> (기존 꼭지·담당자·증명은 대체됩니다).
        </p>
        <form action={regenerateInstruction} className="mt-3 space-y-2">
          <input type="hidden" name="instructionId" value={inst.id} />
          <textarea
            name="feedback"
            className="input min-h-24"
            placeholder="예: 마케팅을 둘로 나눠 — 온라인 광고와 오프라인 행사로. 그리고 법무 검토 단계를 맨 앞에 추가해."
            required
          />
          <SubmitButton pendingText="AI가 다시 만드는 중…">다시 만들기</SubmitButton>
        </form>
      </details>

      {/* milestone management */}
      <div className="space-y-3">
        <h2 className="font-semibold">꼭지 관리</h2>
        {inst.milestones.map((m, i) => {
          const proof = (Array.isArray(m.proof) ? m.proof : []) as unknown as ProofItem[];
          return (
            <div key={m.id} className="card">
              <div className="flex items-center justify-between">
                <span className="font-medium">꼭지 {i + 1}. {m.title}</span>
                <form action={deleteMilestone}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                </form>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <form action={updateMilestone} className="space-y-2">
                  <input type="hidden" name="id" value={m.id} />
                  <input name="title" defaultValue={m.title} className="input" />
                  <input name="expectedResult" defaultValue={m.expectedResult ?? ""} placeholder="기대 결과 (완료 기준)" className="input" />
                  <input name="dueAt" type="date" defaultValue={m.dueAt ? m.dueAt.toISOString().slice(0, 10) : ""} className="input" />
                  <button className="btn-ghost text-xs">저장</button>
                </form>

                <div className="space-y-2">
                  <form action={assignMilestoneOwner} className="flex gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <select name="ownerId" defaultValue={m.ownerId ?? ""} className="input">
                      <option value="">담당자 지정</option>
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <button className="btn-ghost text-xs">배정</button>
                  </form>
                  <form action={setMilestoneStatus} className="flex gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <select name="status" defaultValue={m.status} className="input">
                      <option value="PENDING">대기</option>
                      <option value="ACTIVE">진행</option>
                      <option value="BLOCKED">막힘</option>
                      <option value="DONE">완료</option>
                    </select>
                    <button className="btn-ghost text-xs">상태 변경</button>
                  </form>
                </div>
              </div>

              {/* proof */}
              <div className="mt-3 rounded-md bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-500">결과 / 증명</div>
                {proof.length === 0 && <p className="mt-1 text-xs text-gray-400">아직 증명이 없습니다.</p>}
                {proof.map((p, j) => (
                  <p key={j} className="mt-1 text-sm">
                    {p.type === "link" ? (
                      <a href={p.value} target="_blank" rel="noreferrer" className="text-indigo-600 underline break-all">{p.value}</a>
                    ) : (
                      <span>{p.value}</span>
                    )}
                    <span className="ml-2 text-[11px] text-gray-400">{p.by}</span>
                  </p>
                ))}
                <form action={addMilestoneProof} className="mt-2 flex gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <select name="type" className="input w-24 text-xs"><option value="note">메모</option><option value="link">링크</option></select>
                  <input name="value" placeholder="결과물 링크 또는 메모" className="input text-sm" />
                  <button className="btn-ghost text-xs">추가</button>
                </form>
              </div>
            </div>
          );
        })}

        <form action={addMilestone} className="card flex gap-2 border-dashed">
          <input type="hidden" name="instructionId" value={inst.id} />
          <input name="title" placeholder="꼭지 직접 추가" className="input" />
          <button className="btn-ghost text-sm">＋ 추가</button>
        </form>
      </div>

      <form action={archiveInstruction}>
        <input type="hidden" name="id" value={inst.id} />
        <button className="text-sm text-gray-400 hover:text-red-600">지시 보관</button>
      </form>
    </div>
  );
}
