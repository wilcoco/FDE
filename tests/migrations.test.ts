/**
 * Migration integrity test — applies every SQL migration in order against an
 * embedded real Postgres (pglite), then probes the resulting schema
 * adversarially: new enum value works, invalid values fail, unique constraints
 * bite, cascades cascade.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(__dirname, "..", "prisma", "migrations");

export async function run(t: (name: string, fn: () => void | Promise<void>) => void | Promise<void>) {
  const db = new PGlite();

  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(); // timestamp prefixes → chronological

  await t(`all ${dirs.length} migrations apply cleanly in order`, async () => {
    for (const dir of dirs) {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      try {
        await db.exec(sql);
      } catch (e) {
        throw new Error(`migration ${dir} failed: ${(e as Error).message}`);
      }
    }
  });

  await t("seed a tenant + users + instruction", async () => {
    await db.exec(`
      INSERT INTO "Tenant" (id, slug, name, plan, "isolationMode", "updatedAt")
        VALUES ('t1', 'acme', '아크미', 'FREE', 'SHARED', now());
      INSERT INTO "User" (id, "tenantId", email, name, role, status, "updatedAt")
        VALUES ('u-ceo', 't1', 'ceo@acme.com', '김대표', 'OWNER', 'ACTIVE', now()),
               ('u-staff', 't1', 'staff@acme.com', '박사원', 'MEMBER', 'ACTIVE', now());
      INSERT INTO "Instruction" (id, "tenantId", "authorId", "rawText", source, status, "updatedAt")
        VALUES ('i1', 't1', 'u-ceo', '신제품 출시 준비해', 'TEXT', 'ACTIVE', now());
    `);
  });

  await t("passwordHash is now optional (social-only users)", async () => {
    await db.exec(`
      INSERT INTO "User" (id, "tenantId", email, name, role, status, "authProvider", "authSub", "updatedAt")
        VALUES ('u-social', 't1', 'social@acme.com', '소셜', 'MEMBER', 'ACTIVE', 'google', 'g-123', now());
    `);
  });

  await t("milestone accepts the new REVIEW status + review columns", async () => {
    await db.exec(`
      INSERT INTO "Milestone" (id, "tenantId", "instructionId", "order", title, status,
                               "submittedAt", "returnNote", "lastNudgeAt", "updatedAt")
        VALUES ('m1', 't1', 'i1', 0, '시장 조사', 'REVIEW', now(), '기대와 다름', now(), now());
    `);
    const r = await db.query<{ status: string; returnNote: string }>(
      `SELECT status, "returnNote" FROM "Milestone" WHERE id = 'm1'`,
    );
    assert.equal(r.rows[0].status, "REVIEW");
    assert.equal(r.rows[0].returnNote, "기대와 다름");
  });

  await t("bogus milestone status is REJECTED by the enum", async () => {
    await assert.rejects(
      db.exec(`
        INSERT INTO "Milestone" (id, "tenantId", "instructionId", "order", title, status, "updatedAt")
          VALUES ('m-bad', 't1', 'i1', 1, 'x', 'TOTALLY_BOGUS', now());
      `),
    );
  });

  await t("Tenant.lastSweepAt exists and updates", async () => {
    await db.exec(`UPDATE "Tenant" SET "lastSweepAt" = now() WHERE id = 't1'`);
    const r = await db.query<{ lastSweepAt: Date | null }>(
      `SELECT "lastSweepAt" FROM "Tenant" WHERE id = 't1'`,
    );
    assert.ok(r.rows[0].lastSweepAt != null);
  });

  await t("googleDomain uniqueness bites across tenants", async () => {
    await db.exec(`
      UPDATE "Tenant" SET "googleDomain" = 'acme.com' WHERE id = 't1';
      INSERT INTO "Tenant" (id, slug, name, plan, "isolationMode", "updatedAt")
        VALUES ('t2', 'beta', '베타', 'FREE', 'SHARED', now());
    `);
    await assert.rejects(
      db.exec(`UPDATE "Tenant" SET "googleDomain" = 'acme.com' WHERE id = 't2'`),
    );
  });

  await t("JoinRequest lifecycle columns + enum work", async () => {
    await db.exec(`
      INSERT INTO "JoinRequest" (id, "tenantId", email, name, "passwordHash", status)
        VALUES ('jr1', 't1', 'new@acme.com', '신입', 'hash', 'PENDING');
      UPDATE "JoinRequest" SET status = 'APPROVED', "decidedAt" = now(), "decidedById" = 'u-ceo'
        WHERE id = 'jr1';
    `);
    const r = await db.query<{ status: string }>(`SELECT status FROM "JoinRequest" WHERE id = 'jr1'`);
    assert.equal(r.rows[0].status, "APPROVED");
  });

  await t("PasswordResetToken token uniqueness bites", async () => {
    await db.exec(`
      INSERT INTO "PasswordResetToken" (id, "tenantId", "userId", token, "expiresAt")
        VALUES ('prt1', 't1', 'u-ceo', 'tok-abc', now() + interval '1 hour');
    `);
    await assert.rejects(
      db.exec(`
        INSERT INTO "PasswordResetToken" (id, "tenantId", "userId", token, "expiresAt")
          VALUES ('prt2', 't1', 'u-staff', 'tok-abc', now() + interval '1 hour');
      `),
    );
  });

  await t("MilestoneComment: instruction-level + milestone-level notes, mentions JSON", async () => {
    await db.exec(`
      INSERT INTO "Milestone" (id, "tenantId", "instructionId", "order", title, status, "updatedAt")
        VALUES ('m2', 't1', 'i1', 2, '노트대상', 'ACTIVE', now());
      INSERT INTO "MilestoneComment" (id, "tenantId", "instructionId", "milestoneId", "authorId", body, mentions)
        VALUES ('mc1', 't1', 'i1', NULL, 'u-ceo', '지시 전체 노트', '[]'),
               ('mc2', 't1', 'i1', 'm2', 'u-staff', '@김대표 확인요', '["u-ceo"]');
    `);
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "MilestoneComment" WHERE "instructionId" = 'i1'`,
    );
    assert.equal(r.rows[0].n, 2);
  });

  await t("delegation chain: sub-instruction links to parent milestone, survives its deletion", async () => {
    await db.exec(`
      INSERT INTO "Milestone" (id, "tenantId", "instructionId", "order", title, status, "updatedAt")
        VALUES ('m-del', 't1', 'i1', 5, '위임될 꼭지', 'ACTIVE', now());
      INSERT INTO "Instruction" (id, "tenantId", "authorId", "rawText", source, status, "parentMilestoneId", "updatedAt")
        VALUES ('i-sub', 't1', 'u-staff', '하위 지시', 'TEXT', 'ACTIVE', 'm-del', now());
    `);
    const linked = await db.query<{ parentMilestoneId: string | null }>(
      `SELECT "parentMilestoneId" FROM "Instruction" WHERE id = 'i-sub'`,
    );
    assert.equal(linked.rows[0].parentMilestoneId, "m-del");
    // deleting the parent milestone must PROMOTE the sub-instruction, not destroy it
    await db.exec(`DELETE FROM "Milestone" WHERE id = 'm-del'`);
    const after = await db.query<{ parentMilestoneId: string | null }>(
      `SELECT "parentMilestoneId" FROM "Instruction" WHERE id = 'i-sub'`,
    );
    assert.equal(after.rows[0].parentMilestoneId, null);
  });

  await t("DataTable/DataRow: structured do-data, cascades with its milestone", async () => {
    await db.exec(`
      INSERT INTO "Milestone" (id, "tenantId", "instructionId", "order", title, status, "updatedAt")
        VALUES ('m-dt', 't1', 'i1', 7, '발송', 'ACTIVE', now());
      INSERT INTO "DataTable" (id, "tenantId", "milestoneId", name, columns, "createdById")
        VALUES ('dt1', 't1', 'm-dt', '거래처 발송', '[{"key":"c0","label":"거래처","type":"text"}]', 'u-staff');
      INSERT INTO "DataRow" (id, "tenantId", "tableId", "values", "createdById")
        VALUES ('dr1', 't1', 'dt1', '{"c0":"OO상사"}', 'u-staff'),
               ('dr2', 't1', 'dt1', '{"c0":"XX상사"}', 'u-staff');
    `);
    const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "DataRow" WHERE "tableId" = 'dt1'`);
    assert.equal(rows.rows[0].n, 2);
    // deleting the milestone cascades table + rows
    await db.exec(`DELETE FROM "Milestone" WHERE id = 'm-dt'`);
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "DataRow" WHERE "tableId" = 'dt1'`);
    assert.equal(after.rows[0].n, 0);
  });

  await t("email intake: tenant inbound token + EMAIL-source instruction with thread id", async () => {
    await db.exec(`
      UPDATE "Tenant" SET "inboundToken" = 'x7k2ab', "storeEmailBody" = false WHERE id = 't1';
      INSERT INTO "Instruction" (id, "tenantId", "authorId", "rawText", source, status, "threadMessageId", counterparty, "updatedAt")
        VALUES ('i-mail', 't1', 'u-ceo', '[메타데이터만] 견적 받아줘', 'EMAIL', 'ACTIVE', 'msg-1@mail', 'vendor@partner.co.kr', now());
    `);
    const r = await db.query<{ source: string; threadMessageId: string }>(
      `SELECT source, "threadMessageId" FROM "Instruction" WHERE id = 'i-mail'`,
    );
    assert.equal(r.rows[0].source, "EMAIL");
    assert.equal(r.rows[0].threadMessageId, "msg-1@mail");
    const cp = await db.query<{ counterparty: string }>(`SELECT counterparty FROM "Instruction" WHERE id='i-mail'`);
    assert.equal(cp.rows[0].counterparty, "vendor@partner.co.kr");
    // inbound token is unique across tenants
    await assert.rejects(db.exec(`UPDATE "Tenant" SET "inboundToken" = 'x7k2ab' WHERE id = 't2'`));
  });

  await t("deleting an instruction cascades to its milestones", async () => {
    await db.exec(`DELETE FROM "Instruction" WHERE id = 'i1'`);
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Milestone" WHERE "instructionId" = 'i1'`,
    );
    assert.equal(r.rows[0].n, 0);
  });

  await db.close();
}
