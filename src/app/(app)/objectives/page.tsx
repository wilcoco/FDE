import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  addObjective, addKeyResult, updateKeyResultProgress, addGoal,
} from "@/app/actions/objectives";

const LEVEL_LABEL: Record<string, string> = { COMPANY: "회사", DEPARTMENT: "부서", INDIVIDUAL: "개인" };

export default async function ObjectivesPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageObjectives(user.role);

  const [objectives, goals, members] = await Promise.all([
    prisma.objective.findMany({
      where: { tenantId: tenant.id },
      include: { keyResults: true, owner: true, parent: true },
      orderBy: [{ level: "asc" }, { createdAt: "asc" }],
    }),
    prisma.goal.findMany({ where: { tenantId: tenant.id }, include: { objective: true, owner: true, _count: { select: { definitions: true } } } }),
    prisma.user.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

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
