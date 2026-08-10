-- Structured "do" data: user-defined tables attached to a milestone.
-- Evolution path (additive only, not built here): DataTable.templateId to bind
-- a schema to a crystallized process, and DataRow.milestoneId for per-row
-- provenance so one schema accumulates rows across many process runs.

-- CreateTable
CREATE TABLE "DataTable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataTable_tenantId_idx" ON "DataTable"("tenantId");
CREATE INDEX "DataTable_milestoneId_idx" ON "DataTable"("milestoneId");
CREATE INDEX "DataRow_tenantId_idx" ON "DataRow"("tenantId");
CREATE INDEX "DataRow_tableId_idx" ON "DataRow"("tableId");

-- AddForeignKey
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataRow" ADD CONSTRAINT "DataRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataRow" ADD CONSTRAINT "DataRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DataTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataRow" ADD CONSTRAINT "DataRow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
