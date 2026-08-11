-- SMTP submission settings for compose-in-app (Option B). null = derived.
ALTER TABLE "MailConnection" ADD COLUMN "smtpHost" TEXT;
ALTER TABLE "MailConnection" ADD COLUMN "smtpPort" INTEGER;
