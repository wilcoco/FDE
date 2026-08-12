// Gmail API connector (OAuth) — the no-app-password path for Google mailboxes.
// SEND-ONLY by design: gmail.send is a *sensitive* scope (verification only),
// while every mailbox-reading scope — including gmail.metadata — is on
// Google's *restricted* list and triggers the annual CASA security assessment.
// We never read the mailbox at all: SAYs are born in the app (we mint the
// Message-ID ourselves, Gmail preserves it) and replies arrive through the
// 직답 button, so Saydog structurally cannot see a single byte of the
// user's Gmail — a privacy guarantee enforced by Google, not by restraint.
// Separate OAuth client from login (GOOGLE_MAIL_CLIENT_ID) so the login app
// stays published/unlimited while Gmail runs as a 100-user testing beta.

import { appUrl } from "./app-url";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export function gmailOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_MAIL_CLIENT_ID && process.env.GOOGLE_MAIL_CLIENT_SECRET);
}

function clientId(): string { return process.env.GOOGLE_MAIL_CLIENT_ID ?? ""; }
function clientSecret(): string { return process.env.GOOGLE_MAIL_CLIENT_SECRET ?? ""; }

export function gmailRedirectUri(): string {
  return `${appUrl()}/api/mail/google/callback`;
}

export function gmailAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline", // we need a refresh token
    prompt: "consent", // force refresh_token issuance on re-connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return ((await res.json()) as TokenResponse).access_token;
}

/** Pull the email address out of an id_token without verification round-trips
 * (we just exchanged the code over TLS with Google — the payload is trusted). */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// ── Gmail REST helpers ───────────────────────────────────────────────────────

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Send a raw RFC822 message via Gmail (lands in the user's real Sent folder
 * automatically). The Message-ID is OURS: buildMessage() already stamps the
 * id we minted, and Gmail preserves a supplied RFC 5322 Message-ID — so
 * threading works without ever reading anything back (which would need the
 * restricted gmail.metadata scope).
 */
export async function gmailSendRaw(accessToken: string, rawMessage: string): Promise<void> {
  const res = await fetch(`${API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(rawMessage, "binary").toString("base64url") }),
  });
  if (!res.ok) throw new Error(`gmail send: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
