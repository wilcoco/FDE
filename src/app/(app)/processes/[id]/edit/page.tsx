import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import Flowchart from "@/components/Flowchart";
import {
  addNode, updateNode, deleteNode, addEdge, deleteEdge, updateDefinitionMeta,
} from "@/app/actions/process";

export default async function EditProcess({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireContext();
  const def = await prisma.processDefinition.findFirst({
    where: { id, tenantId: tenant.id },
    include: { nodes: { orderBy: { type: "asc" } }, edges: true },
  });
  if (!def) notFound();
  if (def.status !== "DRAFT" && def.status !== "REJECTED") redirect(`/processes/${id}`);
  const goals = await prisma.goal.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" } });

  const keyById = new Map(def.nodes.map((n) => [n.id, n.key]));
  const nameById = new Map(def.nodes.map((n) => [n.id, n.name]));
  const fcNodes = def.nodes.map((n) => ({ key: n.key, type: n.type, name: n.name }));
  const fcEdges = def.edges.map((e) => ({
    from: keyById.get(e.fromNodeId) ?? "", to: keyById.get(e.toNodeId) ?? "", label: e.label,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/processes/${id}`} className="text-sm text-gray-400 hover:underline">← {def.name}</Link>
          <h1 className="mt-1 text-2xl font-bold">프로세스 편집</h1>
          <p className="text-sm text-gray-500">노드와 연결을 직접 수정하세요. 수정한 그래프가 최종본입니다.</p>
        </div>
      </div>

      <div className="card">
        <Flowchart nodes={fcNodes} edges={fcEdges} />
      </div>

      <form action={updateDefinitionMeta} className="card grid gap-3 md:grid-cols-3">
        <input type="hidden" name="id" value={def.id} />
        <div>
          <label className="label">이름</label>
          <input name="name" defaultValue={def.name} className="input" />
        </div>
        <div>
          <label className="label">설명</label>
          <input name="description" defaultValue={def.description ?? ""} className="input" />
        </div>
        <div>
          <label className="label">목표 연결 (선택)</label>
          <select name="goalId" defaultValue={def.goalId ?? ""} className="input">
            <option value="">연결 안 함</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div className="md:col-span-3"><button className="btn-ghost">메타 저장</button></div>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* nodes */}
        <div className="space-y-4">
          <h2 className="font-semibold">노드</h2>
          {def.nodes.map((n) => (
            <div key={n.id} className="card">
              <div className="flex items-center justify-between">
                <span className="badge bg-indigo-50 text-indigo-700">{n.type}</span>
                {n.type !== "START" && n.type !== "END" && (
                  <form action={deleteNode}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                  </form>
                )}
              </div>
              <form action={updateNode} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={n.id} />
                <input name="name" defaultValue={n.name} className="input" />
                {n.type === "TASK" && (
                  <input
                    name="assigneeDescription"
                    defaultValue={(n.config as { assignee?: { description?: string } })?.assignee?.description ?? ""}
                    placeholder="담당자 설명 (실행 시 지정)"
                    className="input"
                  />
                )}
                {n.type === "APPROVAL" && (
                  <div className="flex gap-2">
                    <select name="approvalKind" defaultValue={n.approvalKind ?? "GENERAL"} className="input">
                      <option value="GENERAL">일반 결재 (상급자)</option>
                      <option value="COST">비용 결재 (전결규정)</option>
                    </select>
                    <input name="amountField" defaultValue="amount" placeholder="금액 필드" className="input" />
                    <input name="levels" type="number" defaultValue={1} className="input w-20" title="상급자 단계 수" />
                  </div>
                )}
                <button className="btn-ghost text-xs">노드 저장</button>
              </form>
            </div>
          ))}

          <form action={addNode} className="card space-y-2 border-dashed">
            <input type="hidden" name="definitionId" value={def.id} />
            <div className="flex gap-2">
              <select name="type" className="input">
                <option value="TASK">작업</option>
                <option value="APPROVAL">결재</option>
                <option value="AUTOMATION">자동화</option>
                <option value="CONDITION">분기</option>
                <option value="END">종료</option>
              </select>
              <input name="name" placeholder="노드 이름" className="input" />
            </div>
            <button className="btn-ghost text-xs">＋ 노드 추가</button>
          </form>
        </div>

        {/* edges */}
        <div className="space-y-4">
          <h2 className="font-semibold">연결 (흐름)</h2>
          <div className="card space-y-2">
            {def.edges.length === 0 && <p className="text-sm text-gray-400">연결이 없습니다.</p>}
            {def.edges.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span>
                  {nameById.get(e.fromNodeId)} → {nameById.get(e.toNodeId)}
                  {e.label && <span className="ml-1 text-gray-400">({e.label})</span>}
                </span>
                <form action={deleteEdge}>
                  <input type="hidden" name="id" value={e.id} />
                  <button className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                </form>
              </div>
            ))}
          </div>

          <form action={addEdge} className="card space-y-2 border-dashed">
            <input type="hidden" name="definitionId" value={def.id} />
            <div className="flex gap-2">
              <select name="fromNodeId" className="input" required>
                <option value="">출발 노드</option>
                {def.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <select name="toNodeId" className="input" required>
                <option value="">도착 노드</option>
                {def.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-gray-400">조건 분기 (선택)</summary>
              <div className="mt-2 flex gap-2">
                <input name="conditionField" placeholder="필드 (예: amount)" className="input" />
                <select name="conditionOp" className="input">
                  <option value="">연산자</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                  <option value="eq">=</option>
                  <option value="ne">≠</option>
                </select>
                <input name="conditionValue" placeholder="값" className="input" />
              </div>
              <input name="label" placeholder="라벨 (예: 100만원 초과)" className="input mt-2" />
            </details>
            <button className="btn-ghost text-xs">＋ 연결 추가</button>
          </form>
        </div>
      </div>
    </div>
  );
}
