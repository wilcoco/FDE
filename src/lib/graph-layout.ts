/**
 * Simple layered (Sugiyama-lite) auto-layout for rendering a process graph as a
 * flowchart. Assigns each node a layer = longest path from a START node, then
 * positions nodes in columns (layer) × rows (order within layer).
 */

export interface LayoutNode {
  key: string;
  type: string;
  name: string;
  x: number;
  y: number;
  status?: string;
}
export interface LayoutEdge {
  from: string;
  to: string;
  label?: string | null;
}
export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

interface InNode {
  key: string;
  type: string;
  name: string;
  status?: string;
}
interface InEdge {
  from: string;
  to: string;
  label?: string | null;
}

const COL_W = 220;
const ROW_H = 110;
const PAD = 40;

export function layoutGraph(nodes: InNode[], edges: InEdge[]): Layout {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.key, []);
    indeg.set(n.key, 0);
  }
  for (const e of edges) {
    if (!adj.has(e.from) || !indeg.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // longest-path layering via topological relaxation (cycle-safe with a cap)
  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.key, 0);
  const order = topo(nodes.map((n) => n.key), adj, indeg);
  for (const k of order) {
    const lk = layer.get(k) ?? 0;
    for (const m of adj.get(k) ?? []) {
      if ((layer.get(m) ?? 0) < lk + 1) layer.set(m, lk + 1);
    }
  }

  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.key) ?? 0;
    const list = byLayer.get(l) ?? [];
    list.push(n.key);
    byLayer.set(l, list);
  }

  const pos = new Map<string, { x: number; y: number }>();
  let maxRow = 0;
  for (const [l, keys] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    keys.forEach((k, row) => {
      pos.set(k, { x: PAD + l * COL_W, y: PAD + row * ROW_H });
      maxRow = Math.max(maxRow, row);
    });
  }

  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    key: n.key,
    type: n.type,
    name: n.name,
    status: n.status,
    x: pos.get(n.key)?.x ?? PAD,
    y: pos.get(n.key)?.y ?? PAD,
  }));

  const maxLayer = Math.max(0, ...[...byLayer.keys()]);
  return {
    nodes: layoutNodes,
    edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    width: PAD * 2 + (maxLayer + 1) * COL_W,
    height: PAD * 2 + (maxRow + 1) * ROW_H,
  };
}

function topo(keys: string[], adj: Map<string, string[]>, indeg: Map<string, number>): string[] {
  const deg = new Map(indeg);
  const q = keys.filter((k) => (deg.get(k) ?? 0) === 0);
  const out: string[] = [];
  const seen = new Set<string>();
  while (q.length) {
    const k = q.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    for (const m of adj.get(k) ?? []) {
      deg.set(m, (deg.get(m) ?? 0) - 1);
      if ((deg.get(m) ?? 0) <= 0 && !seen.has(m)) q.push(m);
    }
  }
  // append any leftover (cycles) so they still render
  for (const k of keys) if (!seen.has(k)) out.push(k);
  return out;
}
