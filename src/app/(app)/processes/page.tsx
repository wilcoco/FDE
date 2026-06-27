import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  PENDING: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ARCHIVED: "bg-gray-100 text-gray-400",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  PENDING: "승인 대기",
  ACTIVE: "활성",
  REJECTED: "반려",
  ARCHIVED: "보관",
};

export default async function ProcessesPage() {
  const { tenant } = await requireContext();
  const defs = await prisma.processDefinition.findMany({
    where: { tenantId: tenant.id, status: { not: "ARCHIVED" } },
    include: { goal: true, _count: { select: { nodes: true, instances: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">프로세스 템플릿</h1>
        <Link href="/processes/new" className="btn">＋ 새 프로세스</Link>
      </div>

      {defs.length === 0 ? (
        <div className="card text-center text-gray-500">
          아직 프로세스가 없습니다. <Link href="/processes/new" className="text-indigo-600">첫 프로세스를 만들어보세요.</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {defs.map((d) => (
            <Link key={d.id} href={`/processes/${d.id}`} className="card transition hover:shadow-md">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{d.name}</h3>
                <span className={`badge ${STATUS_BADGE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
              </div>
              {d.description && <p className="mt-2 line-clamp-2 text-sm text-gray-500">{d.description}</p>}
              <div className="mt-3 flex gap-3 text-xs text-gray-400">
                <span>노드 {d._count.nodes}</span>
                <span>실행 {d._count.instances}회</span>
                {d.goal && <span>🎯 {d.goal.title}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
