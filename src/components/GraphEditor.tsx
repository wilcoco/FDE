"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { layoutGraph } from "@/lib/graph-layout";
import {
  moveNode, createNode, renameAndConfigureNode, removeNode,
  connectNodes, configureEdge, removeEdge,
  type EditorNode, type EditorEdge,
} from "@/app/actions/process-graph";
import type { NodeType, ApprovalKind } from "@prisma/client";

const W = 176;
const H = 64;

const TYPE_LABEL: Record<string, string> = {
  START: "시작", END: "종료", TASK: "작업", APPROVAL: "결재", AUTOMATION: "자동", CONDITION: "분기",
};
function nodeStyle(type: string): { bg: string; border: string } {
  switch (type) {
    case "START": case "END": return { bg: "#f3f4f6", border: "#9ca3af" };
    case "TASK": return { bg: "#e0e7ff", border: "#6366f1" };
    case "APPROVAL": return { bg: "#fef9c3", border: "#d97706" };
    case "AUTOMATION": return { bg: "#f3e8ff", border: "#9333ea" };
    case "CONDITION": return { bg: "#dcfce7", border: "#16a34a" };
    default: return { bg: "#fff", border: "#9ca3af" };
  }
}

interface Props {
  definitionId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
}

export default function GraphEditor({ definitionId, nodes: initNodes, edges: initEdges }: Props) {
  const router = useRouter();
  const [nodes, setNodes] = useState<EditorNode[]>(initNodes);
  const [edges, setEdges] = useState<EditorEdge[]>(initEdges);
  const [sel, setSel] = useState<{ kind: "node" | "edge"; id: string } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const connectFrom = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  // auto-seed positions for freshly generated graphs (all at 0,0)
  useEffect(() => {
    if (initNodes.length && initNodes.every((n) => n.posX === 0 && n.posY === 0)) {
      const keyToId = new Map(initNodes.map((n) => [n.key, n.id]));
      const lay = layoutGraph(
        initNodes.map((n) => ({ key: n.key, type: n.type, name: n.name })),
        initEdges.map((e) => ({
          from: initNodes.find((n) => n.id === e.fromNodeId)?.key ?? "",
          to: initNodes.find((n) => n.id === e.toNodeId)?.key ?? "",
        })),
      );
      const seeded = initNodes.map((n) => {
        const p = lay.nodes.find((l) => l.key === n.key);
        return p ? { ...n, posX: p.x, posY: p.y } : n;
      });
      setNodes(seeded);
      seeded.forEach((n) => { void moveNode(definitionId, n.id, n.posX, n.posY); });
      void keyToId; // (kept for clarity)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = useCallback((e: { clientX: number; clientY: number }) => {
    const el = wrapRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  }, []);

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const p = point(e);
      const { id, dx, dy } = dragRef.current;
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, posX: Math.max(0, p.x - dx), posY: Math.max(0, p.y - dy) } : n)));
    } else if (connectFrom.current) {
      setPreview(point(e));
    }
  };

  const onMouseUp = () => {
    if (dragRef.current) {
      const { id } = dragRef.current;
      const n = nodes.find((x) => x.id === id);
      if (n) void moveNode(definitionId, id, n.posX, n.posY);
      dragRef.current = null;
    }
    if (connectFrom.current) { connectFrom.current = null; setPreview(null); }
  };

  const startDrag = (e: React.MouseEvent, n: EditorNode) => {
    e.preventDefault();
    const p = point(e);
    dragRef.current = { id: n.id, dx: p.x - n.posX, dy: p.y - n.posY };
    setSel({ kind: "node", id: n.id });
  };

  const startConnect = (e: React.MouseEvent, n: EditorNode) => {
    e.stopPropagation();
    e.preventDefault();
    connectFrom.current = n.id;
    setPreview(point(e));
  };

  const endConnect = async (e: React.MouseEvent, target: EditorNode) => {
    e.stopPropagation();
    const from = connectFrom.current;
    connectFrom.current = null;
    setPreview(null);
    if (!from || from === target.id) return;
    const edge = await connectNodes(definitionId, from, target.id);
    if (edge) setEdges((es) => [...es, edge]);
  };

  const addNode = async (type: NodeType) => {
    const wrap = wrapRef.current;
    const x = (wrap?.scrollLeft ?? 0) + 60 + (nodes.length % 4) * 30;
    const y = (wrap?.scrollTop ?? 0) + 60 + (nodes.length % 4) * 30;
    const n = await createNode(definitionId, type, x, y);
    setNodes((ns) => [...ns, n]);
    setSel({ kind: "node", id: n.id });
  };

  const delNode = async (id: string) => {
    await removeNode(id);
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.fromNodeId !== id && e.toNodeId !== id));
    setSel(null);
  };

  const delEdge = async (id: string) => {
    await removeEdge(id);
    setEdges((es) => es.filter((e) => e.id !== id));
    setSel(null);
  };

  const handlePos = (n: EditorNode) => ({
    out: { x: n.posX + W, y: n.posY + H / 2 },
    in: { x: n.posX, y: n.posY + H / 2 },
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const maxX = Math.max(900, ...nodes.map((n) => n.posX + W + 80));
  const maxY = Math.max(560, ...nodes.map((n) => n.posY + H + 80));

  const selNode = sel?.kind === "node" ? nodes.find((n) => n.id === sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? edges.find((e) => e.id === sel.id) : undefined;

  return (
    <div className="flex gap-4">
      {/* canvas */}
      <div className="flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">노드 추가:</span>
          {(["TASK", "APPROVAL", "AUTOMATION", "CONDITION", "END"] as NodeType[]).map((t) => (
            <button key={t} onClick={() => addNode(t)} className="btn-ghost text-xs">＋ {TYPE_LABEL[t]}</button>
          ))}
          <span className="ml-auto text-xs text-gray-400">노드 헤더를 끌어 이동 · 오른쪽 점에서 끌어 연결 · 클릭하여 편집</span>
        </div>
        <div
          ref={wrapRef}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={() => setSel(null)}
          className="relative h-[600px] overflow-auto rounded-lg border border-gray-200 bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]"
        >
          <div style={{ width: maxX, height: maxY, position: "relative" }}>
            <svg width={maxX} height={maxY} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <defs>
                <marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,3 L0,6 z" fill="#64748b" />
                </marker>
              </defs>
              {edges.map((e) => {
                const a = byId.get(e.fromNodeId); const b = byId.get(e.toNodeId);
                if (!a || !b) return null;
                const s = handlePos(a).out; const t = handlePos(b).in;
                const mx = (s.x + t.x) / 2;
                const d = `M ${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${t.y}, ${t.x} ${t.y}`;
                const active = sel?.kind === "edge" && sel.id === e.id;
                const hasCond = e.condition && Object.keys(e.condition).length > 0;
                return (
                  <g key={e.id} style={{ pointerEvents: "stroke", cursor: "pointer" }}
                     onClick={(ev) => { ev.stopPropagation(); setSel({ kind: "edge", id: e.id }); }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                    <path d={d} fill="none" stroke={active ? "#4f46e5" : "#64748b"} strokeWidth={active ? 2.5 : 1.5} markerEnd="url(#ar)" />
                    {(e.label || hasCond) && (
                      <text x={mx} y={(s.y + t.y) / 2 - 5} fontSize={10} fill="#4f46e5" textAnchor="middle">
                        {e.label || condLabel(e.condition)}
                      </text>
                    )}
                  </g>
                );
              })}
              {preview && connectFrom.current && (() => {
                const a = byId.get(connectFrom.current!); if (!a) return null;
                const s = handlePos(a).out;
                return <path d={`M ${s.x} ${s.y} L ${preview.x} ${preview.y}`} stroke="#a5b4fc" strokeWidth={2} strokeDasharray="4 3" fill="none" />;
              })()}
            </svg>

            {nodes.map((n) => {
              const st = nodeStyle(n.type);
              const selected = sel?.kind === "node" && sel.id === n.id;
              return (
                <div key={n.id} style={{ position: "absolute", left: n.posX, top: n.posY, width: W, height: H }}
                     onClick={(ev) => { ev.stopPropagation(); setSel({ kind: "node", id: n.id }); }}>
                  <div className="relative h-full rounded-lg shadow-sm"
                       style={{ background: st.bg, border: `${selected ? 2.5 : 1.5}px solid ${selected ? "#4f46e5" : st.border}` }}>
                    {/* draggable header */}
                    <div onMouseDown={(ev) => startDrag(ev, n)} className="cursor-move px-2 pt-1.5 text-[10px] text-gray-500 select-none">
                      {TYPE_LABEL[n.type]}
                    </div>
                    <div className="px-2 text-[13px] font-medium leading-tight text-gray-900 select-none truncate">
                      {n.name}
                    </div>
                    {/* input handle */}
                    {n.type !== "START" && (
                      <div onMouseUp={(ev) => endConnect(ev, n)} title="연결 받기"
                           className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-gray-400" />
                    )}
                    {/* output handle */}
                    {n.type !== "END" && (
                      <div onMouseDown={(ev) => startConnect(ev, n)} title="끌어서 연결"
                           className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-indigo-500" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* inspector */}
      <div className="w-72 shrink-0">
        {selNode && <NodeInspector key={selNode.id} node={selNode}
          onSaved={(u) => setNodes((ns) => ns.map((n) => (n.id === u.id ? u : n)))}
          onDelete={() => delNode(selNode.id)} onRefresh={() => router.refresh()} />}
        {selEdge && <EdgeInspector key={selEdge.id} edge={selEdge} nodes={nodes}
          onSaved={(u) => setEdges((es) => es.map((e) => (e.id === u.id ? u : e)))}
          onDelete={() => delEdge(selEdge.id)} />}
        {!sel && <div className="card text-sm text-gray-400">노드나 연결을 선택하면 여기서 편집합니다.</div>}
      </div>
    </div>
  );
}

function condLabel(c: Record<string, unknown>): string {
  if (!c?.field) return "";
  const map: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", ne: "≠" };
  return `${c.field} ${map[String(c.op)] ?? ""} ${c.value}`;
}

function NodeInspector({ node, onSaved, onDelete }: {
  node: EditorNode;
  onSaved: (n: EditorNode) => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(node.name);
  const assignee = node.config?.assignee as { description?: string; amountField?: string; levels?: number } | undefined;
  const [desc, setDesc] = useState(assignee?.description ?? "담당자");
  const [kind, setKind] = useState<ApprovalKind>((node.approvalKind ?? "GENERAL") as ApprovalKind);
  const [amountField, setAmountField] = useState(assignee?.amountField ?? "amount");
  const [levels, setLevels] = useState(assignee?.levels ?? 1);
  const automation = node.config?.automation as { action?: string } | undefined;
  const [action, setAction] = useState(automation?.action ?? "notify");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const u = await renameAndConfigureNode(node.id, {
      name, approvalKind: kind, assigneeDescription: desc, amountField, levels: Number(levels), automationAction: action,
    });
    onSaved(u); setBusy(false);
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="badge bg-indigo-50 text-indigo-700">{TYPE_LABEL[node.type]}</span>
        {node.type !== "START" && <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-600">삭제</button>}
      </div>
      <div>
        <label className="label">이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </div>
      {node.type === "TASK" && (
        <div>
          <label className="label">담당자 설명 (실행 시 지정)</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} className="input" />
        </div>
      )}
      {node.type === "APPROVAL" && (
        <>
          <div>
            <label className="label">결재 종류</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ApprovalKind)} className="input">
              <option value="GENERAL">일반 (조직도 상급자)</option>
              <option value="COST">비용 (전결규정)</option>
            </select>
          </div>
          {kind === "COST" ? (
            <div><label className="label">금액 필드</label><input value={amountField} onChange={(e) => setAmountField(e.target.value)} className="input" /></div>
          ) : (
            <div><label className="label">상급자 단계 수</label><input type="number" value={levels} onChange={(e) => setLevels(Number(e.target.value))} className="input" /></div>
          )}
        </>
      )}
      {node.type === "AUTOMATION" && (
        <div>
          <label className="label">자동 동작</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="input">
            <option value="notify">알림</option>
            <option value="setField">필드 설정</option>
          </select>
        </div>
      )}
      <button onClick={save} disabled={busy} className="btn w-full text-sm">{busy ? "저장 중…" : "노드 저장"}</button>
    </div>
  );
}

function EdgeInspector({ edge, nodes, onSaved, onDelete }: {
  edge: EditorEdge;
  nodes: EditorNode[];
  onSaved: (e: EditorEdge) => void;
  onDelete: () => void;
}) {
  const c = edge.condition as { field?: string; op?: string; value?: unknown };
  const [label, setLabel] = useState(edge.label ?? "");
  const [field, setField] = useState(c?.field ?? "");
  const [op, setOp] = useState(c?.op ?? "");
  const [value, setValue] = useState(c?.value != null ? String(c.value) : "");
  const [busy, setBusy] = useState(false);
  const from = nodes.find((n) => n.id === edge.fromNodeId)?.name;
  const to = nodes.find((n) => n.id === edge.toNodeId)?.name;

  const save = async () => {
    setBusy(true);
    const u = await configureEdge(edge.id, { label, field, op, value });
    onSaved(u); setBusy(false);
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="badge bg-gray-100 text-gray-600">연결</span>
        <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-600">삭제</button>
      </div>
      <p className="text-xs text-gray-500">{from} → {to}</p>
      <div><label className="label">라벨</label><input value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder="예: 100만원 초과" /></div>
      <div>
        <label className="label">조건 분기 (선택)</label>
        <div className="flex gap-1">
          <input value={field} onChange={(e) => setField(e.target.value)} placeholder="필드" className="input" />
          <select value={op} onChange={(e) => setOp(e.target.value)} className="input w-20">
            <option value="">-</option><option value="gt">&gt;</option><option value="gte">≥</option>
            <option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option><option value="ne">≠</option>
          </select>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="값" className="input w-20" />
        </div>
      </div>
      <button onClick={save} disabled={busy} className="btn w-full text-sm">{busy ? "저장 중…" : "연결 저장"}</button>
    </div>
  );
}
