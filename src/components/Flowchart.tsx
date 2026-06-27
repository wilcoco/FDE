import { layoutGraph } from "@/lib/graph-layout";

interface Props {
  nodes: { key: string; type: string; name: string; status?: string }[];
  edges: { from: string; to: string; label?: string | null }[];
}

const BOX_W = 168;
const BOX_H = 52;

const TYPE_LABEL: Record<string, string> = {
  START: "시작",
  END: "종료",
  TASK: "작업",
  APPROVAL: "결재",
  AUTOMATION: "자동",
  CONDITION: "분기",
};

function fill(type: string, status?: string): string {
  if (status === "ACTIVE") return "#fef3c7";
  if (status === "DONE" || status === "APPROVED") return "#dcfce7";
  if (status === "REJECTED") return "#fee2e2";
  switch (type) {
    case "START":
    case "END": return "#f3f4f6";
    case "TASK": return "#e0e7ff";
    case "APPROVAL": return "#fef9c3";
    case "AUTOMATION": return "#f3e8ff";
    case "CONDITION": return "#dcfce7";
    default: return "#ffffff";
  }
}

function stroke(type: string, status?: string): string {
  if (status === "ACTIVE") return "#d97706";
  if (status === "REJECTED") return "#dc2626";
  if (status === "DONE" || status === "APPROVED") return "#16a34a";
  return "#9ca3af";
}

/** Server-rendered SVG flowchart with auto-layout. */
export default function Flowchart({ nodes, edges }: Props) {
  if (nodes.length === 0) {
    return <div className="text-sm text-gray-400">노드가 없습니다.</div>;
  }
  const layout = layoutGraph(nodes, edges);
  const pos = new Map(layout.nodes.map((n) => [n.key, n]));

  return (
    <div className="overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
      <svg width={Math.max(layout.width, 320)} height={Math.max(layout.height, 120)}>
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 z" fill="#94a3b8" />
          </marker>
        </defs>
        {layout.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + BOX_W;
          const y1 = a.y + BOX_H / 2;
          const x2 = b.x;
          const y2 = b.y + BOX_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
              {e.label && (
                <text x={mx} y={(y1 + y2) / 2 - 4} fontSize={10} fill="#6b7280" textAnchor="middle">
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {layout.nodes.map((n) => (
          <g key={n.key}>
            <rect
              x={n.x}
              y={n.y}
              width={BOX_W}
              height={BOX_H}
              rx={10}
              fill={fill(n.type, n.status)}
              stroke={stroke(n.type, n.status)}
              strokeWidth={n.status === "ACTIVE" ? 2.5 : 1.5}
            />
            <text x={n.x + 10} y={n.y + 20} fontSize={9} fill="#6b7280">
              {TYPE_LABEL[n.type] ?? n.type}
            </text>
            <text x={n.x + 10} y={n.y + 38} fontSize={12} fill="#111827" fontWeight={500}>
              {n.name.length > 20 ? n.name.slice(0, 19) + "…" : n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
