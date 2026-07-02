/**
 * Stall/overdue sweep across all tenants — run this from a real scheduler
 * (e.g. a Railway cron service) for guaranteed cadence:
 *
 *   npm run jobs:sweep
 *
 * The app also sweeps lazily on dashboard/inbox loads (throttled per tenant),
 * so this job is belt-and-braces, not a hard requirement.
 */
import { prisma } from "../src/lib/db";
import { sweepTenant } from "../src/lib/sweep";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  let totalNudged = 0;
  for (const t of tenants) {
    const r = await sweepTenant(t.id);
    totalNudged += r.nudged;
    if (r.nudged > 0) console.log(`[sweep] ${t.slug}: scanned ${r.scanned}, nudged ${r.nudged}`);
  }
  await prisma.tenant.updateMany({ data: { lastSweepAt: new Date() } });
  console.log(`[sweep] done — ${tenants.length} tenants, ${totalNudged} nudges`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
