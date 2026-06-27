import Link from "next/link";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";

const BADGE: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};
const LABEL: Record<string, string> = {
  RUNNING: "진행 중", COMPLETED: "완료", REJECTED: "반려", CANCELLED: "취소",
};

export default async function InstancesPage() {
  const { tenant } = await requireContext();
  const instances = await prisma.processInstance.findMany({
    where: { tenantId: tenant.id },
    include: {
      definition: true,
      initiator: true,
      nodeRuns: { where: { status: "ACTIVE" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">실행 현황</h1>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="th">제목</th>
              <th className="th">프로세스</th>
              <th className="th">기안자</th>
              <th className="th">현재 단계</th>
              <th className="th">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {instances.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="td">
                  <Link href={`/instances/${i.id}`} className="font-medium text-indigo-600 hover:underline">
                    {i.title}
                  </Link>
                </td>
                <td className="td text-gray-500">{i.definition.name}</td>
                <td className="td text-gray-500">{i.initiator.name}</td>
                <td className="td text-gray-500">
                  {i.nodeRuns.map((n) => n.name).join(", ") || "—"}
                </td>
                <td className="td"><span className={`badge ${BADGE[i.status]}`}>{LABEL[i.status]}</span></td>
              </tr>
            ))}
            {instances.length === 0 && (
              <tr><td className="td text-gray-400" colSpan={5}>진행 중인 프로세스가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
