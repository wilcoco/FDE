/**
 * Tests for secret encryption (IMAP app passwords at rest).
 * Adversarial: tampered ciphertext must fail loudly, not decrypt quietly.
 */
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";

export async function run(t: (name: string, fn: () => void) => void) {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-crypto";

  t("round-trip: encrypt then decrypt returns the original", () => {
    const secret = "네이버-앱비밀번호-ABC123!@#";
    assert.equal(decryptSecret(encryptSecret(secret)), secret);
  });

  t("same plaintext encrypts differently each time (random IV)", () => {
    assert.notEqual(encryptSecret("x"), encryptSecret("x"));
  });

  t("tampered ciphertext throws (GCM auth tag)", () => {
    const stored = encryptSecret("password");
    const parts = stored.split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff; // flip a bit
    parts[3] = data.toString("base64");
    assert.throws(() => decryptSecret(parts.join(":")));
  });

  t("garbage input throws, never returns junk", () => {
    assert.throws(() => decryptSecret("not-a-secret"));
    assert.throws(() => decryptSecret("v1:AA:BB:CC"));
    assert.throws(() => decryptSecret(""));
  });

  t("empty string round-trips (edge)", () => {
    assert.equal(decryptSecret(encryptSecret("")), "");
  });
}
