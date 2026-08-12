// Server-only helper: load a user's decrypted IMAP connection.
// Deliberately NOT in an actions file — "use server" exports are client-
// invocable endpoints, and this returns a decrypted credential.

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import type { ImapConn } from "./mail-fetch";

export async function loadMailConn(
  userId: string,
): Promise<(ImapConn & { smtpHost: string | null; smtpPort: number | null; smtpAllowSelfSigned: boolean; lastSyncAt: Date | null }) | null> {
  const row = await prisma.mailConnection.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    email: row.email,
    login: row.loginUser,
    pass: decryptSecret(row.encPass),
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpAllowSelfSigned: row.smtpAllowSelfSigned,
    lastSyncAt: row.lastSyncAt,
  };
}
