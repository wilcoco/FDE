import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";

export default async function InstructionsPage() {
  const { tenant } = await requireContext();
  const instructions = await prisma.instruction.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    include: { author: true, objective: true, milestones: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">지시 목록</h1>
        <Link href="/capture" className="btn">＋ 지시하기</Link>
      </div>

      {instructions.length === 0 ? (
        <div className="card text-center text-gray-500">
          아직 지시가 없습니다. <Link href="/capture" className="text-indigo-600">첫 지시를 내려보세요.</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {instructions.map((inst) => {
            const total = inst.milestones.length;
            const done = inst.milestones.filter((m) => m.status === "DONE").length;
            const blocked = inst.milestones.filter((m) => m.status === "BLOCKED").length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <Link key={inst.id} href={`/instructions/${inst.id}`} className="card block transition hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{inst.summary || inst.rawText.slice(0, 50)}</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      {inst.author.name} · 꼭지 {done}/{total} 완료
                      {blocked > 0 && <span className="ml-1 text-red-500">· 막힘 {blocked}</span>}
                      {inst.objective && <span className="ml-1">· 🎯 {inst.objective.title}</span>}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-indigo-600">{pct}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gray-200">
                  <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
