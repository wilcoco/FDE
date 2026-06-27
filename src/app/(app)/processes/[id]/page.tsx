import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import Flowchart from "@/components/Flowchart";
import { submitForApproval, archiveDefinition } from "@/app/actions/process";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안", PENDING: "승인 대기", ACTIVE: "활성", REJECTED: "반려", ARCHIVED: "보관",
};

export default async function ProcessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireContext();
  const def = await prisma.processDefinition.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      nodes: true,
      edges: true,
      goal: true,
      createdBy: true,
      approvals: {
        where: { subjectType: "PROCESS_REGISTRATION" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { steps: { orderBy: { order: "asc" }, include: { approver: true } } },
      },
    },
  });
  if (!def) notFound();

  const keyById = new Map(def.nodes.map((n) => [n.id, n.key]));
  const fcNodes = def.nodes.map((n) => ({ key: n.key, type: n.type, name: n.name }));
  const fcEdges = def.edges.map((e) => ({
    from: keyById.get(e.fromNodeId) ?? "",
    to: keyById.get(e.toNodeId) ?? "",
    label: e.label,
  }));
  const editable = def.status === "DRAFT" || def.status === "REJECTED";
  const reg = def.approvals[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/processes" className="text-sm text-gray-400 hover:underline">← 프로세스</Link>
          <h1 className="mt-1 text-2xl font-bold">{def.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{def.description}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span className="badge bg-gray-100 text-gray-600">{STATUS_LABEL[def.status]}</span>
            <span>작성자 {def.createdBy.name}</span>
            {def.goal && <span>🎯 {def.goal.title}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {editable && <Link href={`/processes/${def.id}/edit`} className="btn-ghost">편집</Link>}
          {editable && (
            <form action={submitForApproval}>
              <input type="hidden" name="id" value={def.id} />
              <button className="btn">등록 승인 요청</button>
            </form>
          )}
          {def.status === "ACTIVE" && (
            <Link href={`/processes/${def.id}/start`} className="btn">실행(기안)</Link>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">프로세스 순서도</h2>
        <Flowchart nodes={fcNodes} edges={fcEdges} />
      </div>

      {reg && (
        <div className="card">
          <h2 className="mb-3 font-semibold">등록 승인 진행</h2>
          {reg.steps.length === 0 ? (
            <p className="text-sm text-gray-500">결재선이 없어 자동 승인되었습니다.</p>
          ) : (
            <ol className="space-y-2">
              {reg.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-gray-400">{s.order + 1}.</span>
                  <span className="font-medium">{s.approver.name}</span>
                  <span className={`badge ${
                    s.status === "APPROVED" ? "bg-green-100 text-green-700"
                    : s.status === "REJECTED" ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-500"}`}>
                    {s.status === "APPROVED" ? "승인" : s.status === "REJECTED" ? "반려" : "대기"}
                  </span>
                  {s.comment && <span className="text-gray-400">“{s.comment}”</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {def.sourceManual && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">원본 매뉴얼 (자연어)</summary>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{def.sourceManual}</pre>
        </details>
      )}

      <form action={archiveDefinition}>
        <input type="hidden" name="id" value={def.id} />
        <button className="text-sm text-gray-400 hover:text-red-600">프로세스 보관</button>
      </form>
    </div>
  );
}
