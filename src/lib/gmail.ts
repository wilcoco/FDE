// Gmail API connector (OAuth) — the no-app-password path for Google mailboxes.
// Privacy holds at the SCOPE level: gmail.metadata can read headers but is
// cryptographically unable to fetch bodies; gmail.send only submits mail.
// Separate OAuth client from login (GOOGLE_MAIL_CLIENT_ID) so the login app
// stays published/unlimited while Gmail runs as a 100-user testing beta.

import { appUrl } from "./app-url";
import type { MailEnvelope } from "./connector";
import type { ListedMail } from "./mail-fetch";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.metadata",
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

async function api(accessToken: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`gmail api ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

interface GmailHeader { name: string; value: string }
interface GmailMessageMeta {
  id: string;
  payload?: { headers?: GmailHeader[] };
  internalDate?: string;
}

/** Convert Gmail metadata headers into our envelope shape. Pure. */
export function gmailMetaToEnvelope(msg: GmailMessageMeta): MailEnvelope {
  const h = new Map((msg.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  const split = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  return {
    messageId: (h.get("message-id") ?? "").replace(/^<|>$/g, "").trim() || `gmail-${msg.id}`,
    inReplyTo: h.get("in-reply-to") ?? null,
    references: h.get("references") ?? null,
    subject: h.get("subject") ?? null,
    from: h.get("from") ?? null,
    to: [...split(h.get("to")), ...split(h.get("cc"))],
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
  };
}

/** Recent messages of a label (SENT / INBOX), headers only (metadata scope). */
export async function gmailListRecent(accessToken: string, label: "SENT" | "INBOX", n = 20): Promise<ListedMail[]> {
  const list = (await api(accessToken, `/messages?labelIds=${label}&maxResults=${n}`)) as {
    messages?: { id: string }[];
  };
  // fetch all metadata in PARALLEL — 20 sequential round-trips was the /mail lag
  const metas = await Promise.all(
    (list.messages ?? []).map((m) =>
      api(
        accessToken,
        `/messages/${m.id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
      ) as unknown as Promise<GmailMessageMeta>,
    ),
  );
  return metas.map((meta, i) => ({ ...gmailMetaToEnvelope(meta), seq: i + 1, mailbox: label, uid: meta.id }));
}

/**
 * Send a raw RFC822 message via Gmail (lands in the user's real Sent folder
 * automatically). Returns the Message-ID Gmail actually stored — Gmail may
 * rewrite the header, and the reply thread will reference THEIRS, so we read
 * it back instead of trusting what we wrote.
 */
export async function gmailSendRaw(accessToken: string, rawMessage: string): Promise<string> {
  const sent = (await api(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(rawMessage, "binary").toString("base64url") }),
  })) as { id: string };
  const meta = (await api(
    accessToken,
    `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
  )) as unknown as GmailMessageMeta;
  const h = new Map((meta.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return (h.get("message-id") ?? "").replace(/^<|>$/g, "").trim() || `gmail-${sent.id}`;
}
