/**
 * Tenant import — load a tenant dump (from extract-tenant) into a fresh,
 * dedicated database. The other half of the independence flow.
 *
 *   npm run tenant:import -- exports/<slug>.json
 *
 * Rows keep their original ids, so all relations are preserved. Cyclic/self
 * references (department parent/head, user manager, objective parent) are
 * nulled on first insert and patched in a second pass. Run against a
 * freshly-migrated database (npx prisma migrate deploy).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

// FK-safe insert order
const MODELS = [
  "tenant", "position", "department", "user", "approvalAuthorityRule",
  "invitation", "objective", "keyResult", "goal", "processDefinition",
  "processNode", "processEdge", "processInstance", "instanceEdge",
  "nodeInstance", "workLog", "comment", "directive", "approvalRequest",
  "approvalStep", "instanceChange", "notification", "auditLog",
] as const;

// self/cross references deferred to a second pass to break FK cycles
const DEFERRED: Record<string, string[]> = {
  department: ["parentId", "headId"],
  user: ["managerId"],
  objective: ["parentId"],
};

const DATE_FIELDS = new Set([
  "createdAt", "updatedAt", "completedAt", "decidedAt", "activatedAt",
  "acceptedAt", "expiresAt", "readAt", "resolvedAt", "appliedAt",
]);

function revive(row: Record<string, unknown>) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (DATE_FIELDS.has(k) && typeof out[k] === "string") out[k] = new Date(out[k] as string);
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run tenant:import -- exports/<slug>.json");
    process.exit(1);
  }
  const dump = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>[]>;

  // pass 1: insert (deferred refs nulled)
  let total = 0;
  for (const model of MODELS) {
    const deferred = DEFERRED[model] ?? [];
    const rows = (dump[model] ?? []).map((r) => {
      const row = revive(r);
      for (const f of deferred) row[f] = null;
      return row;
    });
    if (rows.length === 0) continue;
    // @ts-expect-error dynamic model access by name
    const res = await prisma[model].createMany({ data: rows, skipDuplicates: true });
    total += res.count;
    console.log(`  ${model}: ${res.count}`);
  }

  // pass 2: patch deferred references
  for (const [model, fields] of Object.entries(DEFERRED)) {
    for (const r of dump[model] ?? []) {
      const data: Record<string, unknown> = {};
      for (const f of fields) if (r[f] != null) data[f] = r[f];
      if (Object.keys(data).length === 0) continue;
      // @ts-expect-error dynamic model access by name
      await prisma[model].update({ where: { id: r.id }, data });
    }
  }

  console.log(`\n✅ Imported ${total} rows from ${file}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
