import type { MilestoneStatus } from "@prisma/client";

export interface MilestoneCard {
  id: string;
  order: number;
  title: string;
  status: MilestoneStatus;
  ownerName?: string | null;
  expectedResult?: string | null;
}

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  PENDING: "대기", ACTIVE: "진행", BLOCKED: "막힘", DONE: "완료",
};
const STATUS_STYLE: Record<MilestoneStatus, string> = {
  PENDING: "border-gray-300 bg-gray-50 text-gray-500",
  ACTIVE: "border-amber-400 bg-amber-50 text-amber-800",
  BLOCKED: "border-red-400 bg-red-50 text-red-700",
  DONE: "border-green-400 bg-green-50 text-green-700",
};

/** Flow view — shows ORDER (순서). */
export function MilestoneFlow({ milestones }: { milestones: MilestoneCard[] }) {
  const sorted = [...milestones].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {sorted.map((m, i) => (
        <div key={m.id} className="flex items-stretch gap-2">
          <div className={`w-44 rounded-lg border-2 p-3 ${STATUS_STYLE[m.status]}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold">꼭지 {i + 1}</span>
              <span className="text-[10px]">{STATUS_LABEL[m.status]}</span>
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">{m.title}</div>
            {m.ownerName && <div className="mt-1 text-[11px] text-gray-500">담당 {m.ownerName}</div>}
          </div>
          {i < sorted.length - 1 && <div className="flex items-center text-gray-300">→</div>}
        </div>
      ))}
    </div>
  );
}

/** Board view — shows STATUS (상태 스냅샷). */
export function MilestoneBoard({ milestones }: { milestones: MilestoneCard[] }) {
  const cols: MilestoneStatus[] = ["PENDING", "ACTIVE", "BLOCKED", "DONE"];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cols.map((c) => {
        const items = milestones.filter((m) => m.status === c).sort((a, b) => a.order - b.order);
        return (
          <div key={c} className="rounded-lg bg-gray-50 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-gray-600">{STATUS_LABEL[c]}</span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((m) => (
                <div key={m.id} className={`rounded-md border-l-4 bg-white p-2 shadow-sm ${STATUS_STYLE[m.status].split(" ")[0]}`}>
                  <div className="text-sm font-medium text-gray-900">{m.title}</div>
                  {m.ownerName && <div className="mt-1 text-[11px] text-gray-500">{m.ownerName}</div>}
                </div>
              ))}
              {items.length === 0 && <div className="px-1 text-[11px] text-gray-300">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
