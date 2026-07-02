import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { decideApproval, markNotificationsRead } from "@/app/actions/approval";
import { approveMilestone, returnMilestone } from "@/app/actions/capture";
import { maybeSweep } from "@/lib/sweep";

export default async function Inbox() {
  const { tenant, user } = await requireContext();
  void maybeSweep(tenant.id); // lazy stall/overdue watchdog

  const [steps, tasks, myMilestones, reviewQueue, notifications] = await Promise.all([
    prisma.approvalStep.findMany({
      where: { tenantId: tenant.id, approverId: user.id, status: "PENDING" },
      include: {
        request: {
          include: {
            requester: true,
            definition: true,
            nodeInstance: { include: { instance: true } },
            change: { include: { instance: true } },
          },
        },
      },
    }),
    prisma.nodeInstance.findMany({
      where: { tenantId: tenant.id, assigneeId: user.id, status: "ACTIVE", type: "TASK", instance: { status: "RUNNING" } },
      include: { instance: true, directives: { where: { status: "OPEN" } } },
      orderBy: { activatedAt: "desc" },
    }),
    prisma.milestone.findMany({
      where: { tenantId: tenant.id, ownerId: user.id, status: { in: ["ACTIVE", "BLOCKED", "REVIEW"] }, instruction: { status: "ACTIVE" } },
      include: { instruction: true },
      orderBy: { activatedAt: "desc" },
    }),
    // milestones others submitted that wait on MY confirmation
    prisma.milestone.findMany({
      where: { tenantId: tenant.id, status: "REVIEW", instruction: { status: "ACTIVE", authorId: user.id } },
      include: { instruction: true, owner: true },
      orderBy: { submittedAt: "asc" },
    }),
    prisma.notification.findMany({
      where: { tenantId: tenant.id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);
  const myReviews = reviewQueue.filter((m) => m.ownerId !== user.id);

  // only steps that are the current step of a still-pending request
  const myApprovals = steps.filter(
    (s) => s.request.status === "PENDING" && s.request.currentStep === s.order,
  );

  const subjectLabel = (r: (typeof myApprovals)[number]["request"]) => {
    if (r.subjectType === "PROCESS_REGISTRATION") return { kind: "프로세스 등록", name: r.definition?.name, link: r.definitionId ? `/processes/${r.definitionId}` : undefined };
    if (r.subjectType === "NODE_APPROVAL") return { kind: "프로세스 결재", name: r.nodeInstance?.name, link: r.nodeInstance ? `/instances/${r.nodeInstance.instanceId}` : undefined };
    return { kind: "협조업무 추가", name: r.change?.newTaskName, link: r.change ? `/instances/${r.change.instanceId}` : undefined };
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">받은 업무 · 결재</h1>

      {/* approvals */}
      <section>
        <h2 className="mb-3 font-semibold">결재 대기 ({myApprovals.length})</h2>
        <div className="space-y-3">
          {myApprovals.length === 0 && <p className="card text-sm text-gray-400">대기 중인 결재가 없습니다.</p>}
          {myApprovals.map((s) => {
            const subj = subjectLabel(s.request);
            return (
              <div key={s.id} className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="badge bg-amber-100 text-amber-700">{subj.kind}</span>
                    <span className="ml-2 font-medium">{subj.name}</span>
                    {subj.link && <Link href={subj.link} className="ml-2 text-xs text-indigo-600 hover:underline">상세</Link>}
                    <p className="mt-1 text-xs text-gray-400">
                      요청자 {s.request.requester.name}
                      {s.request.amount != null && ` · 금액 ${s.request.amount.toLocaleString()}원`}
                      {s.request.note && ` · ${s.request.note}`}
                    </p>
                  </div>
                </div>
                <form action={decideApproval} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="requestId" value={s.request.id} />
                  <input name="comment" placeholder="의견 (선택)" className="input flex-1" />
                  <button name="decision" value="approve" className="btn">승인</button>
                  <button name="decision" value="reject" className="btn-danger">반려</button>
                </form>
              </div>
            );
          })}
        </div>
      </section>

      {/* milestones waiting on MY confirmation (review gate) */}
      {myReviews.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-violet-800">🔍 검수 대기 — 내 확인 필요 ({myReviews.length})</h2>
          <div className="space-y-3">
            {myReviews.map((m) => (
              <div key={m.id} className="card border-violet-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-sm text-gray-400">{m.instruction.summary ?? ""}</span>
                  <span className="badge bg-violet-100 text-violet-700">{m.owner?.name ?? "담당자"} 제출</span>
                  <Link href={`/instructions/${m.instructionId}`} className="ml-auto text-xs text-indigo-600 hover:underline">증빙 보기</Link>
                </div>
                {m.expectedResult && <p className="mt-1 text-xs text-gray-500">기대결과: {m.expectedResult}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={approveMilestone}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn px-3 py-1.5 text-xs">확인 (완료 확정)</button>
                  </form>
                  <form action={returnMilestone} className="flex flex-1 gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="note" placeholder="반려 사유" className="input flex-1 py-1.5 text-xs" />
                    <button className="btn-danger px-3 py-1.5 text-xs">반려</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* my milestones (꼭지) */}
      <section>
        <h2 className="mb-3 font-semibold">내 꼭지 ({myMilestones.length})</h2>
        <div className="space-y-2">
          {myMilestones.length === 0 && <p className="card text-sm text-gray-400">배정된 꼭지가 없습니다.</p>}
          {myMilestones.map((m) => (
            <Link key={m.id} href={`/instructions/${m.instructionId}`} className="card flex items-center justify-between transition hover:shadow-md">
              <div>
                <span className="font-medium">{m.title}</span>
                <span className="ml-2 text-sm text-gray-400">{m.instruction.summary ?? ""}</span>
                {m.status === "BLOCKED" && <span className="badge ml-2 bg-red-100 text-red-700">막힘</span>}
                {m.status === "REVIEW" && <span className="badge ml-2 bg-violet-100 text-violet-700">검수 중</span>}
                {m.dueAt && m.dueAt < new Date() && m.status !== "REVIEW" && (
                  <span className="badge ml-2 bg-red-100 text-red-700">⏰ 기한 지남</span>
                )}
                {m.returnNote && m.status === "ACTIVE" && (
                  <p className="mt-1 text-xs text-orange-600">🔁 반려됨: {m.returnNote}</p>
                )}
                {m.expectedResult && <p className="text-xs text-gray-400">기대결과: {m.expectedResult}</p>}
              </div>
              <span className="text-sm text-indigo-600">열기 →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* tasks */}
      <section>
        <h2 className="mb-3 font-semibold">내 작업 (프로세스) ({tasks.length})</h2>
        <div className="space-y-2">
          {tasks.length === 0 && <p className="card text-sm text-gray-400">진행할 작업이 없습니다.</p>}
          {tasks.map((t) => (
            <Link key={t.id} href={`/instances/${t.instanceId}`} className="card flex items-center justify-between transition hover:shadow-md">
              <div>
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-sm text-gray-400">{t.instance.title}</span>
                {t.directives.length > 0 && <span className="badge ml-2 bg-orange-100 text-orange-700">업무지시 {t.directives.length}</span>}
                {t.reworkCount > 0 && <span className="badge ml-2 bg-orange-50 text-orange-600">재작업 {t.reworkCount}</span>}
              </div>
              <span className="text-sm text-indigo-600">열기 →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* notifications */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">알림</h2>
          <form action={markNotificationsRead}><button className="text-xs text-gray-400 hover:underline">모두 읽음</button></form>
        </div>
        <div className="card divide-y divide-gray-100 p-0">
          {notifications.length === 0 && <p className="td text-gray-400">알림이 없습니다.</p>}
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-center justify-between px-4 py-3 ${n.readAt ? "opacity-60" : ""}`}>
              <div>
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-gray-500">{n.body}</p>}
              </div>
              {n.link && <Link href={n.link} className="text-xs text-indigo-600 hover:underline">보기</Link>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
