-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "joinCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_joinCode_key" ON "Tenant"("joinCode");
