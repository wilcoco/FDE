-- 직답 첨부파일 (beta: DB-stored, 5MB cap per file)
CREATE TABLE "ReplyFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplyFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReplyFile_instructionId_idx" ON "ReplyFile"("instructionId");
CREATE INDEX "ReplyFile_tenantId_idx" ON "ReplyFile"("tenantId");
ALTER TABLE "ReplyFile" ADD CONSTRAINT "ReplyFile_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
