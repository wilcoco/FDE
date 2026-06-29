import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";

export default async function Dashboard() {
  const { tenant, user } = await requireContext();

  const [activeInstructions, myMilestones, myApprovalSteps, recent] = await Promise.all([
    prisma.instruction.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    prisma.milestone.count({
      where: { tenantId: tenant.id, ownerId: user.id, status: { in: ["ACTIVE", "BLOCKED"] }, instruction: { status: "ACTIVE" } },
    }),
    prisma.approvalStep.findMany({
      where: { tenantId: tenant.id, approverId: user.id, status: "PENDING" },
      include: { request: true },
    }),
    prisma.instruction.findMany({
      where: { tenantId: tenant.id, status: "ACTIVE" },
      include: { milestones: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const myApprovals = myApprovalSteps.filter(
    (s) => s.request.status === "PENDING" && s.request.currentStep === s.order,
  ).length;

  const stats = [
    { label: "진행 중 지시", value: activeInstructions, href: "/instructions" },
    { label: "내 꼭지", value: myMilestones, href: "/inbox" },
    { label: "내 결재 대기", value: myApprovals, href: "/inbox" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">안녕하세요, {user.name}님</h1>
        <p className="mt-1 text-gray-500">말 한마디면 조직이 움직입니다. 지시하고, 흐르는지 확인하세요.</p>
      </div>

      {/* primary CTA */}
      <Link href="/capture" className="block rounded-xl bg-indigo-600 p-6 text-white transition hover:bg-indigo-700">
        <div className="text-lg font-semibold">＋ 지시하기</div>
        <div className="mt-1 text-sm text-indigo-100">말하거나 적으면 AI가 굵직한 꼭지로 나눠 실행·추적합니다.</div>
      </Link>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card transition hover:shadow-md">
            <div className="text-sm text-gray-500">{s.label}</div>
            <div className="mt-2 text-3xl font-bold text-indigo-600">{s.value}</div>
          </Link>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">최근 지시</h2>
          <Link href="/instructions" className="text-sm text-indigo-600 hover:underline">전체 보기</Link>
        </div>
        <div className="space-y-2">
          {recent.length === 0 && (
            <div className="card text-sm text-gray-400">아직 지시가 없습니다. 위 “지시하기”로 시작하세요.</div>
          )}
          {recent.map((inst) => {
            const total = inst.milestones.length;
            const done = inst.milestones.filter((m) => m.status === "DONE").length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={inst.id} href={`/instructions/${inst.id}`} className="card flex items-center justify-between transition hover:shadow-md">
                <span className="font-medium">{inst.summary || inst.rawText.slice(0, 50)}</span>
                <span className="text-sm text-gray-500">{done}/{total} · {pct}%</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/strategy" className="card transition hover:shadow-md">
          <h3 className="font-semibold">🧭 전략 통일성</h3>
          <p className="mt-2 text-sm text-gray-500">흩어진 지시들의 일관성·모순을 AI가 해석합니다.</p>
        </Link>
        <Link href="/objectives" className="card transition hover:shadow-md">
          <h3 className="font-semibold">🎯 목표 (OKR·KPI)</h3>
          <p className="mt-2 text-sm text-gray-500">지시를 전략 목표에 연결하세요.</p>
        </Link>
      </div>
    </div>
  );
}
