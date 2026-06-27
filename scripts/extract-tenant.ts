/**
 * Tenant extraction — dump one tenant's entire dataset to a portable JSON file.
 *
 * This is the foundation of the "독립화" (independence) offering: because every
 * tenant-owned row carries `tenantId`, a single group can be exported with a
 * uniform `WHERE tenantId = :id` across all tables and re-imported into a fresh,
 * dedicated database (same schema) for an isolated instance.
 *
 *   npm run tenant:extract -- <slug>
 *
 * See docs/TENANT-EXTRACTION.md for the full migration runbook.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";

const prisma = new PrismaClient();

// every tenant-owned model, in FK-safe import order
const MODELS = [
  "tenant", "position", "department", "user", "approvalAuthorityRule",
  "invitation", "objective", "keyResult", "goal", "processDefinition",
  "processNode", "processEdge", "processInstance", "instanceEdge",
  "nodeInstance", "workLog", "comment", "directive", "approvalRequest",
  "approvalStep", "instanceChange", "notification", "auditLog",
] as const;

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run tenant:extract -- <slug>");
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant '${slug}' not found.`);
    process.exit(1);
  }

  const dump: Record<string, unknown> = { _meta: { slug, exportedAt: new Date().toISOString() } };
  let total = 0;
  for (const model of MODELS) {
    const where = model === "tenant" ? { id: tenant.id } : { tenantId: tenant.id };
    // @ts-expect-error dynamic model access by name
    const rows = await prisma[model].findMany({ where });
    dump[model] = rows;
    total += rows.length;
    console.log(`  ${model}: ${rows.length}`);
  }

  mkdirSync("exports", { recursive: true });
  const path = `exports/${slug}.json`;
  writeFileSync(path, JSON.stringify(dump, null, 2));
  console.log(`\n✅ Exported ${total} rows for tenant '${slug}' → ${path}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
