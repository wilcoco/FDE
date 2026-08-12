-- 직답 버튼: tokenized account-free web answer page per instruction
ALTER TABLE "Instruction" ADD COLUMN "replyToken" TEXT;
CREATE UNIQUE INDEX "Instruction_replyToken_key" ON "Instruction"("replyToken");
