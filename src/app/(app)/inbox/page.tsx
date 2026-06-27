import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { decideApproval, markNotificationsRead } from "@/app/actions/approval";

export default async function Inbox() {
  const { tenant, user } = await requireContext();

  const [steps, tasks, notifications] = await Promise.all([
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
    prisma.notification.findMany({
      where: { tenantId: tenant.id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

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

      {/* tasks */}
      <section>
        <h2 className="mb-3 font-semibold">내 작업 ({tasks.length})</h2>
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
