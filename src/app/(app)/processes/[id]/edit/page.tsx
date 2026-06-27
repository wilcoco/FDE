import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import GraphEditor from "@/components/GraphEditor";
import type { EditorNode, EditorEdge } from "@/app/actions/process-graph";
import { updateDefinitionMeta } from "@/app/actions/process";

export default async function EditProcess({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireContext();
  const def = await prisma.processDefinition.findFirst({
    where: { id, tenantId: tenant.id },
    include: { nodes: true, edges: true },
  });
  if (!def) notFound();
  if (def.status !== "DRAFT" && def.status !== "REJECTED") redirect(`/processes/${id}`);
  const goals = await prisma.goal.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" } });

  const nodes: EditorNode[] = def.nodes.map((n) => ({
    id: n.id, key: n.key, type: n.type, name: n.name, approvalKind: n.approvalKind,
    config: (n.config as Record<string, unknown>) ?? {}, posX: n.posX, posY: n.posY,
  }));
  const edges: EditorEdge[] = def.edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, label: e.label,
    condition: (e.condition as Record<string, unknown>) ?? {},
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/processes/${id}`} className="text-sm text-gray-400 hover:underline">← {def.name}</Link>
          <h1 className="mt-1 text-2xl font-bold">프로세스 편집</h1>
          <p className="text-sm text-gray-500">노드를 끌어 배치하고 점을 끌어 연결하세요. 수정한 그래프가 최종본입니다.</p>
        </div>
        <Link href={`/processes/${id}`} className="btn-ghost">완료</Link>
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

      <GraphEditor definitionId={def.id} nodes={nodes} edges={edges} />
    </div>
  );
}
