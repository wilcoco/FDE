import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runSynthesis } from "@/app/actions/capture";
import { promoteInstructionsToTemplate } from "@/app/actions/process";
import SubmitButton from "@/components/SubmitButton";
import type { StrategyResult } from "@/lib/ai";

/** groups with this many instructions are flagged as a recurring pattern */
const RECURRING_MIN = 3;

export default async function StrategyPage() {
  const { tenant } = await requireContext();
  const [latest, instructions, objectives] = await Promise.all([
    prisma.strategySynthesis.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } }),
    prisma.instruction.findMany({ where: { tenantId: tenant.id }, select: { id: true, summary: true, rawText: true } }),
    prisma.objective.findMany({ where: { tenantId: tenant.id }, select: { id: true, title: true } }),
  ]);

  const instLabel = new Map(instructions.map((i) => [i.id, i.summary || i.rawText.slice(0, 40)]));
  const objLabel = new Map(objectives.map((o) => [o.id, o.title]));
  const r = (latest?.result ?? null) as StrategyResult | null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">전략 통일성</h1>
          <p className="mt-1 text-sm text-gray-500">
            정신없이 내린 지시들 사이의 전략적 일관성을 AI가 해석합니다 — 묶고, 모순을 잡고, 목표 없는 지시를 드러냅니다.
            <span className="text-gray-400"> (새 지시 3건마다 자동 분석)</span>
          </p>
        </div>
        <form action={runSynthesis}>
          <button className="btn">AI 재분석</button>
        </form>
      </div>

      {!r ? (
        <div className="card text-center text-gray-500">
          아직 분석이 없습니다. <span className="text-gray-400">지시를 몇 개 내린 뒤</span> “AI 재분석”을 눌러보세요.
        </div>
      ) : (
        <div className="space-y-6">
          {latest && <p className="text-xs text-gray-400">최종 분석 {new Date(latest.createdAt).toLocaleString()}</p>}

          <div className="card">
            <h2 className="mb-3 font-semibold">전략 그룹</h2>
            {r.groups?.length ? (
              <div className="space-y-3">
                {r.groups.map((g, i) => {
                  const recurring = g.instructionIds.length >= RECURRING_MIN;
                  return (
                    <div key={i} className="rounded-md bg-indigo-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-indigo-800">{g.theme}</span>
                        {recurring && <span className="badge bg-amber-100 text-amber-700">🔁 반복 감지</span>}
                      </div>
                      <ul className="mt-1 list-disc pl-5 text-sm text-gray-600">
                        {g.instructionIds.map((iid) => (
                          <li key={iid}><Link href={`/instructions/${iid}`} className="hover:underline">{instLabel.get(iid) ?? iid}</Link></li>
                        ))}
                      </ul>
                      {recurring && (
                        <form action={promoteInstructionsToTemplate} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="theme" value={g.theme} />
                          <input type="hidden" name="instructionIds" value={g.instructionIds.join(",")} />
                          <SubmitButton pendingText="AI가 표준 프로세스를 설계하는 중…">
                            ⚙ 프로세스 템플릿으로 승격
                          </SubmitButton>
                          <span className="text-xs text-gray-500">
                            같은 지시가 반복됩니다 — 표준 프로세스로 만들면 매번 지시하지 않아도 됩니다.
                          </span>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-gray-400">묶인 그룹 없음.</p>}
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold text-red-700">⚠ 모순 / 충돌</h2>
            {r.contradictions?.length ? (
              <ul className="space-y-2">
                {r.contradictions.map((c, i) => (
                  <li key={i} className="rounded-md bg-red-50 p-3 text-sm">
                    <div className="text-red-800">{c.reason}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      <Link href={`/instructions/${c.instructionIdA}`} className="underline">{instLabel.get(c.instructionIdA) ?? c.instructionIdA}</Link>
                      {" ↔ "}
                      <Link href={`/instructions/${c.instructionIdB}`} className="underline">{instLabel.get(c.instructionIdB) ?? c.instructionIdB}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-400">발견된 모순 없음.</p>}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="card">
              <h2 className="mb-3 font-semibold">🎯 목표 매핑</h2>
              {r.goalMap?.length ? (
                <ul className="space-y-1 text-sm">
                  {r.goalMap.map((g, i) => (
                    <li key={i}>
                      <Link href={`/instructions/${g.instructionId}`} className="hover:underline">{instLabel.get(g.instructionId) ?? g.instructionId}</Link>
                      <span className="text-gray-400"> → </span>
                      <span className="font-medium">{objLabel.get(g.objectiveId) ?? g.objectiveId}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-400">매핑 없음.</p>}
            </div>

            <div className="card">
              <h2 className="mb-3 font-semibold text-amber-700">고아 지시 (목표 없음)</h2>
              {r.orphans?.length ? (
                <ul className="space-y-1 text-sm">
                  {r.orphans.map((iid) => (
                    <li key={iid}>
                      <Link href={`/instructions/${iid}`} className="hover:underline">{instLabel.get(iid) ?? iid}</Link>
                      <span className="ml-1 text-xs text-amber-600">일회성? 새 목표?</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-400">고아 지시 없음.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
