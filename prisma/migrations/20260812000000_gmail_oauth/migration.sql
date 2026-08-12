-- OAuth-based Gmail connections (no app passwords)
ALTER TABLE "MailConnection" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'imap';
ALTER TABLE "MailConnection" ADD COLUMN "encRefresh" TEXT;
