-- Data migration: remove the "[예시] 신제품 브로슈어" sample instruction that
-- provisioning used to seed into every new company. Seeding is gone from the
-- code; this cleans up rows already planted. Milestones/comments cascade.
DELETE FROM "Instruction" WHERE "rawText" LIKE '[예시] 이건 FlowDesk 사용법을 보여주는 샘플 지시입니다%';
