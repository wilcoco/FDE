import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  addObjective, addKeyResult, updateKeyResultProgress, addGoal,
} from "@/app/actions/objectives";
import { executionProgress, claimedProgress, sayDoGap } from "@/lib/objective-progress";

const LEVEL_LABEL: Record<string, string> = { COMPANY: "회사", DEPARTMENT: "부서", INDIVIDUAL: "개인" };

export default async function ObjectivesPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageObjectives(user.role);

  const [objectives, goals, members, linkedInstructions] = await Promise.all([
    prisma.objective.findMany({
      where: { tenantId: tenant.id },
      include: { keyResults: true, owner: true, parent: true },
      orderBy: [{ level: "asc" }, { createdAt: "asc" }],
    }),
    prisma.goal.findMany({ where: { tenantId: tenant.id }, include: { objective: true, owner: true, _count: { select: { definitions: true } } } }),
    prisma.user.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    // execution side: every instruction tied to an objective, with its milestones
    prisma.instruction.findMany({
      where: { tenantId: tenant.id, status: "ACTIVE", objectiveId: { not: null } },
      select: { id: true, objectiveId: true, milestones: { select: { status: true } } },
    }),
  ]);

  // roll milestones up per objective
  const milestonesByObjective = new Map<string, { status: string }[]>();
  const instrCountByObjective = new Map<string, number>();
  for (const inst of linkedInstructions) {
    if (!inst.objectiveId) continue;
    const arr = milestonesByObjective.get(inst.objectiveId) ?? [];
    arr.push(...inst.milestones);
    milestonesByObjective.set(inst.objectiveId, arr);
    instrCountByObjective.set(inst.objectiveId, (instrCountByObjective.get(inst.objectiveId) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">목표 — OKR · KPI</h1>

      {admin && (
        <form action={addObjective} className="card grid gap-2 md:grid-cols-6">
          <input name="title" placeholder="목표 제목" className="input md:col-span-2" required />
          <select name="type" className="input"><option value="OKR">OKR(정성)</option><option value="KPI">KPI(정량)</option></select>
          <select name="level" className="input">
            <option value="COMPANY">회사</option><option value="DEPARTMENT">부서</option><option value="INDIVIDUAL">개인</option>
          </select>
          <select name="parentId" className="input">
            <option value="">상위 목표(케스케이딩)</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <select name="ownerId" className="input">
            <option value="">담당자</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input name="period" placeholder="기간 (예: 2026-Q3)" className="input" />
          <input name="description" placeholder="설명" className="input md:col-span-5" />
          <button className="btn">목표 추가</button>
        </form>
      )}

      <div className="grid gap-4">
        {objectives.map((o) => (
          <div key={o.id} className="card">
            <div className="flex items-center gap-2">
              <span className={`badge ${o.type === "OKR" ? "bg-indigo-100 text-indigo-700" : "bg-teal-100 text-teal-700"}`}>{o.type}</span>
              <span className="badge bg-gray-100 text-gray-600">{LEVEL_LABEL[o.level]}</span>
              <h3 className="font-semibold">{o.title}</h3>
              {o.period && <span className="text-xs text-gray-400">{o.period}</span>}
              {o.parent && <span className="text-xs text-gray-400">↳ {o.parent.title}</span>}
              {o.owner && <span className="ml-auto text-xs text-gray-400">{o.owner.name}</span>}
            </div>
            {o.description && <p className="mt-1 text-sm text-gray-500">{o.description}</p>}

            {(() => {
              const exec = executionProgress(milestonesByObjective.get(o.id) ?? []);
              const claim = claimedProgress(o.keyResults);
              const { gap, severity, direction } = sayDoGap({
                claimedPct: claim.pct, hasKrs: claim.hasKrs,
                executionTotal: exec.total, executionPct: exec.pct,
              });
              const instrCount = instrCountByObjective.get(o.id) ?? 0;
              if (exec.total === 0) {
                return (
                  <p className="mt-2 text-xs text-gray-400">
                    연결된 실행(지시)이 없습니다 — 이 목표는 아직 &quot;말&quot;만 있고 실행이 붙지 않았습니다.
                  </p>
                );
              }
              const gapColor = severity === "alert" ? "text-red-600" : severity === "watch" ? "text-amber-600" : "text-gray-400";
              return (
                <div className="mt-3 rounded-md border border-gray-100 bg-gray-50/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-600">🔗 실행 진척 (지시 {instrCount}건 · 꼭지 {exec.done}/{exec.total} 완료)</span>
                    <span className="text-gray-500">{exec.pct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-200">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${exec.pct}%` }} />
                  </div>
                  {(exec.review > 0 || exec.blocked > 0) && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      {exec.review > 0 && <span className="text-violet-600">검수 대기 {exec.review} </span>}
                      {exec.blocked > 0 && <span className="text-red-500">막힘 {exec.blocked}</span>}
                    </p>
                  )}
                  {gap != null && direction !== "even" && (
                    <p className={`mt-2 text-xs font-medium ${gapColor}`}>
                      {severity === "alert" ? "🚨 " : severity === "watch" ? "⚠️ " : ""}
                      Say-Do 격차 {gap > 0 ? "+" : ""}{gap}%p —{" "}
                      {direction === "over"
                        ? `보고된 목표 진척(${claim.pct}%)이 실제 실행(${exec.pct}%)보다 앞서 있습니다`
                        : `실제 실행(${exec.pct}%)이 보고된 목표 진척(${claim.pct}%)보다 앞서 있습니다`}
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="mt-3 space-y-2">
              {o.keyResults.map((kr) => {
                const pct = kr.targetValue ? Math.min(100, Math.round((kr.currentValue / kr.targetValue) * 100)) : 0;
                return (
                  <div key={kr.id} className="rounded-md bg-gray-50 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span>{kr.title} {kr.metric && <span className="text-gray-400">({kr.metric})</span>}</span>
                      <span className="text-gray-500">{kr.currentValue}/{kr.targetValue} {kr.unit} · {pct}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-200"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
                    <form action={updateKeyResultProgress} className="mt-2 flex gap-1">
                      <input type="hidden" name="id" value={kr.id} />
                      <input name="currentValue" type="number" defaultValue={kr.currentValue} className="input py-1 text-xs w-32" />
                      <button className="btn-ghost text-xs">진척 업데이트</button>
                    </form>
                  </div>
                );
              })}
            </div>

            {admin && (
              <form action={addKeyResult} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="objectiveId" value={o.id} />
                <input name="title" placeholder="핵심결과/지표" className="input flex-1" />
                <input name="metric" placeholder="측정항목" className="input w-32" />
                <input name="targetValue" type="number" placeholder="목표치" className="input w-24" />
                <input name="unit" placeholder="단위" className="input w-20" />
                <button className="btn-ghost text-sm">＋ KR/지표</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {/* goals */}
      <section>
        <h2 className="mb-3 font-semibold">세부 업무목표 (Goal)</h2>
        {admin && (
          <form action={addGoal} className="card mb-3 grid gap-2 md:grid-cols-4">
            <input name="title" placeholder="목표 제목" className="input md:col-span-2" required />
            <select name="objectiveId" className="input">
              <option value="">상위 목표 연결(선택)</option>
              {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
            <select name="ownerId" className="input">
              <option value="">담당자</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input name="description" placeholder="설명" className="input md:col-span-3" />
            <button className="btn">Goal 추가</button>
          </form>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <div key={g.id} className="card">
              <h3 className="font-semibold">{g.title}</h3>
              {g.description && <p className="mt-1 text-sm text-gray-500">{g.description}</p>}
              <div className="mt-2 flex gap-3 text-xs text-gray-400">
                {g.objective && <span>🎯 {g.objective.title}</span>}
                {g.owner && <span>{g.owner.name}</span>}
                <span>연결 프로세스 {g._count.definitions}</span>
              </div>
            </div>
          ))}
          {goals.length === 0 && <p className="text-sm text-gray-400">아직 세부 목표가 없습니다.</p>}
        </div>
      </section>
    </div>
  );
}
