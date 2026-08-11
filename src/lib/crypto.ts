// Symmetric encryption for secrets we must be able to use again (IMAP app
// passwords). AES-256-GCM, key derived from AUTH_SECRET — so a DB dump alone
// can't reveal a stored password. Format: v1:<iv>:<tag>:<ciphertext> (base64).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for secret encryption");
  return createHash("sha256").update(`mail-cred:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [ver, ivB64, tagB64, dataB64] = stored.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || dataB64 == null) throw new Error("bad secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
