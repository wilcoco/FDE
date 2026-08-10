-- Email intake (CC push): tenants get a secret inbound address; instructions
-- can originate from mail and remember their thread's Message-ID so replies
-- match back as DO signals. Privacy-by-default: bodies stored only on opt-in.

-- AlterEnum
ALTER TYPE "InstructionSource" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "inboundToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN     "storeEmailBody" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Instruction" ADD COLUMN     "threadMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_inboundToken_key" ON "Tenant"("inboundToken");
CREATE INDEX "Instruction_tenantId_threadMessageId_idx" ON "Instruction"("tenantId", "threadMessageId");
