import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";

export default async function Dashboard() {
  const { tenant, user } = await requireContext();

  const [myTasks, myApprovalSteps, running, activeDefs, openDirectives] = await Promise.all([
    prisma.nodeInstance.count({
      where: { tenantId: tenant.id, assigneeId: user.id, status: "ACTIVE", type: "TASK" },
    }),
    prisma.approvalStep.findMany({
      where: { tenantId: tenant.id, approverId: user.id, status: "PENDING" },
      include: { request: true },
    }),
    prisma.processInstance.count({ where: { tenantId: tenant.id, status: "RUNNING" } }),
    prisma.processDefinition.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    prisma.directive.count({
      where: { tenantId: tenant.id, status: "OPEN", nodeInstance: { assigneeId: user.id } },
    }),
  ]);

  const myApprovals = myApprovalSteps.filter(
    (s) => s.request.status === "PENDING" && s.request.currentStep === s.order,
  ).length;

  const stats = [
    { label: "내 작업", value: myTasks, href: "/inbox" },
    { label: "내 결재 대기", value: myApprovals, href: "/inbox" },
    { label: "진행 중 프로세스", value: running, href: "/instances" },
    { label: "활성 템플릿", value: activeDefs, href: "/processes" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">안녕하세요, {user.name}님</h1>
        <p className="mt-1 text-gray-500">오늘 처리할 업무와 결재를 확인하세요.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card transition hover:shadow-md">
            <div className="text-sm text-gray-500">{s.label}</div>
            <div className="mt-2 text-3xl font-bold text-indigo-600">{s.value}</div>
          </Link>
        ))}
      </div>

      {openDirectives > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            재작업이 필요한 업무 지시가 <b>{openDirectives}건</b> 있습니다.{" "}
            <Link href="/inbox" className="font-medium underline">받은 업무 보기</Link>
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/processes/new" className="card transition hover:shadow-md">
          <h3 className="font-semibold">＋ 새 프로세스 만들기</h3>
          <p className="mt-2 text-sm text-gray-500">업무 매뉴얼을 자연어로 적으면 순서도가 됩니다.</p>
        </Link>
        <Link href="/objectives" className="card transition hover:shadow-md">
          <h3 className="font-semibold">🎯 목표 관리</h3>
          <p className="mt-2 text-sm text-gray-500">OKR/KPI를 정의하고 프로세스와 연결하세요.</p>
        </Link>
        <Link href="/analytics" className="card transition hover:shadow-md">
          <h3 className="font-semibold">📊 업무 분석</h3>
          <p className="mt-2 text-sm text-gray-500">병목·사이클타임·재작업률을 확인하세요.</p>
        </Link>
      </div>
    </div>
  );
}
