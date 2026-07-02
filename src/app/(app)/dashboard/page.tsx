import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { maybeSweep, attentionSummary } from "@/lib/sweep";
import type { StrategyResult } from "@/lib/ai";

export default async function Dashboard() {
  const { tenant, user } = await requireContext();
  await maybeSweep(tenant.id); // stall/overdue watchdog (throttled)

  const [activeInstructions, myMilestones, myApprovalSteps, recent, attention, latestSynthesis] =
    await Promise.all([
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
      attentionSummary(tenant.id, user.id),
      prisma.strategySynthesis.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const myApprovals = myApprovalSteps.filter(
    (s) => s.request.status === "PENDING" && s.request.currentStep === s.order,
  ).length;

  const synth = (latestSynthesis?.result ?? null) as StrategyResult | null;
  const contradictions = synth?.contradictions?.length ?? 0;
  const orphans = synth?.orphans?.length ?? 0;

  const stats = [
    { label: "진행 중 지시", value: activeInstructions, href: "/instructions" },
    { label: "내 꼭지", value: myMilestones, href: "/inbox" },
    { label: "내 결재 대기", value: myApprovals, href: "/inbox" },
  ];

  const hasAttention =
    attention.items.length > 0 || attention.reviewQueue > 0 || contradictions > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">안녕하세요, {user.name}님</h1>
        <p className="mt-1 text-gray-500">말 한마디면 조직이 움직입니다. 지시하고, 흐르는지 확인하세요.</p>
      </div>

      {/* say-do gap: what needs my eyes right now */}
      {hasAttention && (
        <div className="card border-red-200 bg-red-50/40">
          <h2 className="font-semibold text-red-800">🚨 주의 필요</h2>
          <div className="mt-3 space-y-2">
            {attention.reviewQueue > 0 && (
              <Link href="/inbox" className="flex items-center justify-between rounded-md border border-violet-200 bg-white p-2 text-sm hover:shadow-sm">
                <span>🔍 내 확인을 기다리는 검수 <b>{attention.reviewQueue}</b>건</span>
                <span className="text-xs text-indigo-600">확인하러 가기 →</span>
              </Link>
            )}
            {contradictions > 0 && (
              <Link href="/strategy" className="flex items-center justify-between rounded-md border border-red-200 bg-white p-2 text-sm hover:shadow-sm">
                <span>⚠ 지시 간 <b>모순 {contradictions}건</b>{orphans > 0 && ` · 목표 없는 지시 ${orphans}건`}</span>
                <span className="text-xs text-indigo-600">전략 보기 →</span>
              </Link>
            )}
            {attention.items.slice(0, 5).map((it) => (
              <Link key={it.id} href={`/instructions/${it.instructionId}`} className="flex items-center justify-between rounded-md border border-gray-200 bg-white p-2 text-sm hover:shadow-sm">
                <span className="min-w-0">
                  <span className="font-medium">{it.title}</span>
                  <span className="ml-2 text-xs text-red-600">{it.reason}</span>
                  {it.ownerName && <span className="ml-2 text-xs text-gray-400">담당 {it.ownerName}</span>}
                </span>
                <span className="shrink-0 text-xs text-indigo-600">열기 →</span>
              </Link>
            ))}
            {attention.items.length > 5 && (
              <p className="text-xs text-gray-400">외 {attention.items.length - 5}건…</p>
            )}
          </div>
        </div>
      )}

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
          <p className="mt-2 text-sm text-gray-500">흩어진 지시들의 일관성·모순을 AI가 해석합니다. 지시 3건마다 자동 분석됩니다.</p>
        </Link>
        <Link href="/objectives" className="card transition hover:shadow-md">
          <h3 className="font-semibold">🎯 목표 (OKR·KPI)</h3>
          <p className="mt-2 text-sm text-gray-500">지시를 전략 목표에 연결하세요.</p>
        </Link>
      </div>
    </div>
  );
}
