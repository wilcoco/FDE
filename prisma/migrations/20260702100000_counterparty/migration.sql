-- Account-free counterparty: who an email-sourced instruction is waiting on,
-- and whether a reply (DO) has arrived on the thread.
ALTER TABLE "Instruction" ADD COLUMN     "counterparty" TEXT;
ALTER TABLE "Instruction" ADD COLUMN     "replyReceivedAt" TIMESTAMP(3);
