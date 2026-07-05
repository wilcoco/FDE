-- CreateTable
CREATE TABLE "MilestoneComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MilestoneComment_tenantId_idx" ON "MilestoneComment"("tenantId");
CREATE INDEX "MilestoneComment_instructionId_idx" ON "MilestoneComment"("instructionId");
CREATE INDEX "MilestoneComment_milestoneId_idx" ON "MilestoneComment"("milestoneId");

-- AddForeignKey
ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
