-- explicit opt-in for self-signed certs on company SMTP servers
ALTER TABLE "MailConnection" ADD COLUMN "smtpAllowSelfSigned" BOOLEAN NOT NULL DEFAULT false;
