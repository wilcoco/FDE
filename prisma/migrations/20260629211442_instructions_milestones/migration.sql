-- CreateEnum
CREATE TYPE "InstructionSource" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'DONE');

-- CreateTable
CREATE TABLE "Instruction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "summary" TEXT,
    "source" "InstructionSource" NOT NULL DEFAULT 'TEXT',
    "status" "InstructionStatus" NOT NULL DEFAULT 'ACTIVE',
    "objectiveId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "expectedResult" TEXT,
    "ownerId" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "proof" JSONB NOT NULL DEFAULT '[]',
    "dueAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategySynthesis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategySynthesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Instruction_tenantId_idx" ON "Instruction"("tenantId");

-- CreateIndex
CREATE INDEX "Instruction_tenantId_createdAt_idx" ON "Instruction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Milestone_tenantId_idx" ON "Milestone"("tenantId");

-- CreateIndex
CREATE INDEX "Milestone_instructionId_idx" ON "Milestone"("instructionId");

-- CreateIndex
CREATE INDEX "Milestone_tenantId_ownerId_status_idx" ON "Milestone"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "StrategySynthesis_tenantId_idx" ON "StrategySynthesis"("tenantId");

-- CreateIndex
CREATE INDEX "StrategySynthesis_tenantId_createdAt_idx" ON "StrategySynthesis"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySynthesis" ADD CONSTRAINT "StrategySynthesis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySynthesis" ADD CONSTRAINT "StrategySynthesis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
