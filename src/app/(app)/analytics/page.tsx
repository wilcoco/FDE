import { requireContext } from "@/lib/session";
import { tenantAnalytics } from "@/lib/analytics";

export default async function AnalyticsPage() {
  const { tenant } = await requireContext();
  const a = await tenantAnalytics(tenant.id);

  const cards = [
    { label: "진행 중", value: a.running },
    { label: "완료", value: a.completed },
    { label: "반려", value: a.rejected },
    { label: "평균 사이클타임", value: a.avgCycleHours != null ? `${a.avgCycleHours}h` : "—" },
    { label: "총 재작업", value: a.totalRework },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">업무 분석</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="text-sm text-gray-500">{c.label}</div>
            <div className="mt-2 text-2xl font-bold text-indigo-600">{c.value}</div>
          </div>
        ))}
      </div>

      {a.bottleneck && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-amber-800">🚧 병목 노드</h2>
          <p className="mt-1 text-sm text-amber-700">
            가장 오래 걸리는 단계는 <b>{a.bottleneck.name}</b> — 평균 {a.bottleneck.avgHours}시간
            (처리 {a.bottleneck.count}건, 재작업 {a.bottleneck.reworkTotal}회).
          </p>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="th">노드</th><th className="th">처리 건수</th>
              <th className="th">평균 처리시간(h)</th><th className="th">재작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {a.nodeStats.map((s) => (
              <tr key={s.name}>
                <td className="td font-medium">{s.name}</td>
                <td className="td">{s.count}</td>
                <td className="td">{s.avgHours}</td>
                <td className="td">{s.reworkTotal}</td>
              </tr>
            ))}
            {a.nodeStats.length === 0 && <tr><td className="td text-gray-400" colSpan={4}>분석할 실행 데이터가 아직 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
