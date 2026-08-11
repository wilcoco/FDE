-- IMAP login id when it differs from the mail address (self-hosted servers).
ALTER TABLE "MailConnection" ADD COLUMN "loginUser" TEXT;
