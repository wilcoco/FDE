-- Per-user IMAP connection for the in-app mail screen (pull model, no polling).
CREATE TABLE "MailConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "email" TEXT NOT NULL,
    "encPass" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailConnection_userId_key" ON "MailConnection"("userId");
CREATE INDEX "MailConnection_tenantId_idx" ON "MailConnection"("tenantId");

ALTER TABLE "MailConnection" ADD CONSTRAINT "MailConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailConnection" ADD CONSTRAINT "MailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
