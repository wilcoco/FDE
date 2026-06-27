import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import Flowchart from "@/components/Flowchart";
import {
  completeTaskAction, addWorkLog, addComment, issueDirectiveAction, requestInstanceChange,
} from "@/app/actions/instance";

const NODE_BADGE: Record<string, string> = {
  WAITING: "bg-gray-100 text-gray-400", ACTIVE: "bg-amber-100 text-amber-700",
  DONE: "bg-green-100 text-green-700", APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700", SKIPPED: "bg-gray-100 text-gray-400",
};
const NODE_LABEL: Record<string, string> = {
  WAITING: "대기", ACTIVE: "진행 중", DONE: "완료", APPROVED: "승인", REJECTED: "반려", SKIPPED: "건너뜀",
};

export default async function InstanceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant, user } = await requireContext();
  const inst = await prisma.processInstance.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      definition: true,
      initiator: true,
      edges: true,
      nodeRuns: {
        orderBy: { createdAt: "asc" },
        include: {
          assignee: true,
          workLogs: { include: { author: true, comments: { include: { author: true } } }, orderBy: { createdAt: "asc" } },
          comments: { where: { workLogId: null }, include: { author: true }, orderBy: { createdAt: "asc" } },
          directives: { include: { issuer: true }, orderBy: { createdAt: "desc" } },
          approval: { include: { steps: { orderBy: { order: "asc" }, include: { approver: true } } } },
        },
      },
    },
  });
  if (!inst) notFound();

  const members = await prisma.user.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { name: "asc" },
  });

  const fcNodes = inst.nodeRuns.map((n) => ({ key: n.nodeKey, type: n.type, name: n.name, status: n.status }));
  const fcEdges = inst.edges.map((e) => ({ from: e.fromKey, to: e.toKey, label: e.label }));
  const data = inst.data as Record<string, unknown>;
  const running = inst.status === "RUNNING";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/instances" className="text-sm text-gray-400 hover:underline">← 실행 현황</Link>
        <h1 className="mt-1 text-2xl font-bold">{inst.title}</h1>
        <div className="mt-1 flex gap-3 text-sm text-gray-500">
          <span>{inst.definition.name}</span>
          <span>기안자 {inst.initiator.name}</span>
          <span className={`badge ${inst.status === "RUNNING" ? "bg-blue-100 text-blue-700" : inst.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {inst.status === "RUNNING" ? "진행 중" : inst.status === "COMPLETED" ? "완료" : inst.status === "REJECTED" ? "반려" : "취소"}
          </span>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">진행 상황</h2>
        <Flowchart nodes={fcNodes} edges={fcEdges} />
      </div>

      {Object.keys(data).length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">기안 정보</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            {Object.entries(data).map(([k, v]) => (
              <div key={k}><dt className="text-gray-400">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {/* nodes */}
      <div className="space-y-4">
        <h2 className="font-semibold">노드별 진행</h2>
        {inst.nodeRuns.filter((n) => n.type === "TASK" || n.type === "APPROVAL").map((n) => {
          const isAssignee = n.assigneeId === user.id;
          return (
            <div key={n.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="badge bg-indigo-50 text-indigo-700">{n.type === "APPROVAL" ? "결재" : "작업"}</span>
                  <span className="font-medium">{n.name}</span>
                  {n.isAdHoc && <span className="badge bg-purple-100 text-purple-700">협조</span>}
                  {n.reworkCount > 0 && <span className="badge bg-orange-100 text-orange-700">재작업 {n.reworkCount}</span>}
                </div>
                <span className={`badge ${NODE_BADGE[n.status]}`}>{NODE_LABEL[n.status]}</span>
              </div>
              {n.assignee && <p className="mt-1 text-xs text-gray-400">담당: {n.assignee.name}</p>}

              {/* approval steps */}
              {n.type === "APPROVAL" && n.approval && (
                <ol className="mt-3 space-y-1">
                  {n.approval.steps.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400">{s.order + 1}.</span>
                      <span className="font-medium">{s.approver.name}</span>
                      <span className={`badge ${s.status === "APPROVED" ? "bg-green-100 text-green-700" : s.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
                        {s.status === "APPROVED" ? "승인" : s.status === "REJECTED" ? "반려" : "대기"}
                      </span>
                      {s.comment && <span className="text-gray-400">“{s.comment}”</span>}
                    </li>
                  ))}
                  <li className="text-xs text-gray-400">→ 결재는 “받은 업무·결재”에서 처리합니다.</li>
                </ol>
              )}

              {/* work logs */}
              {n.type === "TASK" && (
                <div className="mt-3 space-y-2">
                  {n.workLogs.map((w) => (
                    <div key={w.id} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>{w.author.name}</span>
                        <span>{w.status === "SUBMITTED" ? "제출" : "진행"}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{w.content}</p>
                      {w.comments.map((c) => (
                        <p key={c.id} className="mt-1 border-l-2 border-gray-200 pl-2 text-xs text-gray-500">
                          💬 {c.author.name}: {c.body}
                        </p>
                      ))}
                      <form action={addComment} className="mt-2 flex gap-2">
                        <input type="hidden" name="nodeInstanceId" value={n.id} />
                        <input type="hidden" name="workLogId" value={w.id} />
                        <input name="body" placeholder="질문/답변 댓글" className="input text-xs" />
                        <button className="btn-ghost text-xs">댓글</button>
                      </form>
                    </div>
                  ))}
                  {n.workLogs.length === 0 && <p className="text-xs text-gray-400">아직 업무일지가 없습니다.</p>}

                  {/* assignee controls on active task */}
                  {running && n.status === "ACTIVE" && isAssignee && (
                    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <form action={addWorkLog} className="space-y-2">
                        <input type="hidden" name="nodeInstanceId" value={n.id} />
                        <textarea name="content" placeholder="업무일지 작성…" className="input" required />
                        <div className="flex items-center gap-2">
                          <select name="status" className="input w-40">
                            <option value="IN_PROGRESS">진행 중</option>
                            <option value="SUBMITTED">제출</option>
                          </select>
                          <button className="btn-ghost text-sm">일지 저장</button>
                        </div>
                      </form>
                      <form action={completeTaskAction}>
                        <input type="hidden" name="nodeRunId" value={n.id} />
                        <button className="btn text-sm">작업 완료 →</button>
                      </form>
                    </div>
                  )}

                  {/* open directives */}
                  {n.directives.filter((d) => d.status === "OPEN").map((d) => (
                    <p key={d.id} className="rounded-md bg-orange-50 p-2 text-sm text-orange-800">
                      📌 업무지시 ({d.issuer.name}): {d.body}
                    </p>
                  ))}

                  {/* issue directive (anyone; restriction enforced server-side) */}
                  {running && (
                    <form action={issueDirectiveAction} className="flex gap-2">
                      <input type="hidden" name="nodeInstanceId" value={n.id} />
                      <input name="body" placeholder="업무 지시 (재작업 요청)" className="input text-sm" />
                      <button className="btn-ghost text-sm">업무 지시</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ad-hoc collaboration task */}
      {running && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">＋ 협조 업무 추가 (사후 프로세스 수정)</summary>
          <p className="mt-2 text-sm text-gray-500">
            기존 프로세스에 없지만 목표 달성에 필요한 다른 사람의 업무를 추가 요청합니다. 프로세스 승인체계로 승인된 뒤 흐름에 삽입됩니다.
          </p>
          <form action={requestInstanceChange} className="mt-3 grid gap-2 md:grid-cols-2">
            <input type="hidden" name="instanceId" value={inst.id} />
            <input name="newTaskName" placeholder="협조 업무 이름" className="input" required />
            <select name="newTaskAssigneeId" className="input">
              <option value="">담당자 (선택)</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select name="afterNodeKey" className="input">
              <option value="">삽입 위치 (이 노드 다음)</option>
              {inst.nodeRuns.map((n) => <option key={n.id} value={n.nodeKey}>{n.name}</option>)}
            </select>
            <select name="mode" className="input">
              <option value="PARALLEL">병렬 (본 흐름 계속)</option>
              <option value="INLINE">인라인 (본 흐름 대기)</option>
            </select>
            <textarea name="description" placeholder="설명" className="input md:col-span-2" />
            <button className="btn md:col-span-2">협조 업무 승인 요청</button>
          </form>
        </details>
      )}
    </div>
  );
}
