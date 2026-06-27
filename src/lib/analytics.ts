import { prisma } from "./db";

/**
 * Process performance analytics: cycle time, throughput, rework, and bottleneck
 * detection (the node with the highest average dwell time). Computed from the
 * timestamps the engine records on every NodeInstance.
 */

const MS_PER_HOUR = 1000 * 60 * 60;

export interface NodeStat {
  name: string;
  count: number;
  avgHours: number;
  reworkTotal: number;
}

export interface TenantAnalytics {
  running: number;
  completed: number;
  rejected: number;
  avgCycleHours: number | null;
  totalRework: number;
  nodeStats: NodeStat[];
  bottleneck: NodeStat | null;
}

export async function tenantAnalytics(tenantId: string): Promise<TenantAnalytics> {
  const [instances, nodeRuns] = await Promise.all([
    prisma.processInstance.findMany({ where: { tenantId } }),
    prisma.nodeInstance.findMany({
      where: { tenantId, activatedAt: { not: null }, decidedAt: { not: null } },
    }),
  ]);

  const running = instances.filter((i) => i.status === "RUNNING").length;
  const completed = instances.filter((i) => i.status === "COMPLETED").length;
  const rejected = instances.filter((i) => i.status === "REJECTED").length;

  const cycles = instances
    .filter((i) => i.completedAt)
    .map((i) => (i.completedAt!.getTime() - i.createdAt.getTime()) / MS_PER_HOUR);
  const avgCycleHours = cycles.length
    ? round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : null;

  // aggregate dwell time per node name
  const agg = new Map<string, { total: number; count: number; rework: number }>();
  for (const r of nodeRuns) {
    const dwell = (r.decidedAt!.getTime() - r.activatedAt!.getTime()) / MS_PER_HOUR;
    const cur = agg.get(r.name) ?? { total: 0, count: 0, rework: 0 };
    cur.total += dwell;
    cur.count += 1;
    cur.rework += r.reworkCount;
    agg.set(r.name, cur);
  }
  const nodeStats: NodeStat[] = [...agg.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgHours: round(v.total / v.count),
      reworkTotal: v.rework,
    }))
    .sort((a, b) => b.avgHours - a.avgHours);

  const totalRework = nodeStats.reduce((a, s) => a + s.reworkTotal, 0);
  const bottleneck = nodeStats[0] ?? null;

  return { running, completed, rejected, avgCycleHours, totalRework, nodeStats, bottleneck };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
