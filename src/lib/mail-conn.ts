// Server-only helper: load a user's decrypted mail connection.
// Deliberately NOT in an actions file — "use server" exports are client-
// invocable endpoints, and this returns decrypted credentials.

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import type { ImapConn } from "./mail-fetch";

export interface MailConn extends ImapConn {
  /** "imap" (host/port — POP3 included via port) | "gmail" (OAuth) */
  provider: string;
  /** decrypted OAuth refresh token (gmail only) */
  refresh: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpAllowSelfSigned: boolean;
  lastSyncAt: Date | null;
}

export async function loadMailConn(userId: string): Promise<MailConn | null> {
  const row = await prisma.mailConnection.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    provider: row.provider,
    host: row.host,
    port: row.port,
    email: row.email,
    login: row.loginUser,
    pass: decryptSecret(row.encPass),
    refresh: row.encRefresh ? decryptSecret(row.encRefresh) : null,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpAllowSelfSigned: row.smtpAllowSelfSigned,
    lastSyncAt: row.lastSyncAt,
  };
}
