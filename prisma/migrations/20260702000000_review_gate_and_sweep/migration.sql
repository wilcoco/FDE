-- AlterEnum: milestone gains a review (검수) state between doing and done
ALTER TYPE "MilestoneStatus" ADD VALUE 'REVIEW' BEFORE 'DONE';

-- AlterTable: review gate + nudge bookkeeping
ALTER TABLE "Milestone" ADD COLUMN     "submittedAt" TIMESTAMP(3);
ALTER TABLE "Milestone" ADD COLUMN     "returnNote" TEXT;
ALTER TABLE "Milestone" ADD COLUMN     "lastNudgeAt" TIMESTAMP(3);

-- AlterTable: lazy sweep throttle
ALTER TABLE "Tenant" ADD COLUMN     "lastSweepAt" TIMESTAMP(3);
