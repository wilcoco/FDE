-- AlterTable: org identifiers for social-login auto-join
ALTER TABLE "Tenant" ADD COLUMN     "googleDomain" TEXT;
ALTER TABLE "Tenant" ADD COLUMN     "slackTeamId" TEXT;

-- AlterTable: social login on users; passwordHash optional for social-only accounts
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN     "authProvider" TEXT;
ALTER TABLE "User" ADD COLUMN     "authSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_googleDomain_key" ON "Tenant"("googleDomain");
CREATE UNIQUE INDEX "Tenant_slackTeamId_key" ON "Tenant"("slackTeamId");
CREATE INDEX "User_authProvider_authSub_idx" ON "User"("authProvider", "authSub");
