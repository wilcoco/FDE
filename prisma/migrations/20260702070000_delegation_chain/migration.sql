-- AlterTable: delegation chain (다층 say-do) — an instruction can be spawned
-- from a parent milestone. ON DELETE SET NULL: deleting the parent milestone
-- promotes the sub-instruction to a standalone one instead of destroying a
-- whole delegated subtree.
ALTER TABLE "Instruction" ADD COLUMN     "parentMilestoneId" TEXT;

-- CreateIndex
CREATE INDEX "Instruction_parentMilestoneId_idx" ON "Instruction"("parentMilestoneId");

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_parentMilestoneId_fkey" FOREIGN KEY ("parentMilestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
