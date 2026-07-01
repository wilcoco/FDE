// OAuth 2.0 / OIDC authorization-code flow for social sign-in.
// Supports Google, Slack (OpenID Connect) and Kakao. Providers are only
// offered when their client id/secret env vars are configured, so a
// deployment can enable any subset.

export type ProviderId = "google" | "slack" | "kakao";

export interface SocialProfile {
  /** stable subject id from the provider (unique per provider) */
  sub: string;
  email: string;
  name: string;
  /** org identifier used for auto-join: Google workspace domain / Slack team id */
  orgId?: string;
  /** human-friendly org name, used when first binding a tenant */
  orgName?: string;
}

interface ProviderConfig {
  id: ProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** extra params appended to the authorize URL */
  authorizeParams?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  fetchProfile: (accessToken: string) => Promise<SocialProfile>;
}

function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

export function redirectUri(provider: ProviderId): string {
  return `${appUrl()}/api/auth/${provider}/callback`;
}

// ── provider profile fetchers ────────────────────────────────────────────────

async function googleProfile(accessToken: string): Promise<SocialProfile> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo ${res.status}`);
  const d = (await res.json()) as {
    sub: string;
    email?: string;
    name?: string;
    hd?: string; // hosted domain (Google Workspace)
  };
  return {
    sub: d.sub,
    email: (d.email ?? "").toLowerCase(),
    name: d.name || (d.email ? d.email.split("@")[0] : "사용자"),
    // ONLY Google Workspace accounts carry `hd`; personal gmail has none and
    // must never be treated as an org (else all gmail users share one tenant).
    orgId: d.hd,
    orgName: d.hd,
  };
}

async function slackProfile(accessToken: string): Promise<SocialProfile> {
  const res = await fetch("https://slack.com/api/openid.connect.userInfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`slack userinfo ${res.status}`);
  const d = (await res.json()) as Record<string, string>;
  if (d.ok === "false" || d.error) throw new Error(`slack userinfo ${d.error}`);
  return {
    sub: d.sub,
    email: (d.email ?? "").toLowerCase(),
    name: d.name || d["given_name"] || (d.email ? d.email.split("@")[0] : "사용자"),
    orgId: d["https://slack.com/team_id"],
    orgName: d["https://slack.com/team_name"],
  };
}

async function kakaoProfile(accessToken: string): Promise<SocialProfile> {
  const res = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`kakao userinfo ${res.status}`);
  const d = (await res.json()) as {
    id: number;
    kakao_account?: {
      email?: string;
      profile?: { nickname?: string };
    };
  };
  const email = (d.kakao_account?.email ?? "").toLowerCase();
  return {
    sub: String(d.id),
    email,
    name: d.kakao_account?.profile?.nickname || (email ? email.split("@")[0] : "사용자"),
    // Kakao has no org/team concept — always a personal login
  };
}

// ── registry ─────────────────────────────────────────────────────────────────

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    authorizeParams: { access_type: "online", prompt: "select_account" },
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    fetchProfile: googleProfile,
  },
  slack: {
    id: "slack",
    label: "Slack",
    authorizeUrl: "https://slack.com/openid/connect/authorize",
    tokenUrl: "https://slack.com/api/openid.connect.token",
    scope: "openid email profile",
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    fetchProfile: slackProfile,
  },
  kakao: {
    id: "kakao",
    label: "카카오",
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    scope: "account_email profile_nickname",
    clientId: process.env.KAKAO_CLIENT_ID,
    clientSecret: process.env.KAKAO_CLIENT_SECRET,
    fetchProfile: kakaoProfile,
  },
};

export function isProvider(v: string): v is ProviderId {
  return v === "google" || v === "slack" || v === "kakao";
}

export function providerConfigured(id: ProviderId): boolean {
  const p = PROVIDERS[id];
  return Boolean(p.clientId && p.clientSecret);
}

/** Providers with credentials set — used to render only the available buttons. */
export function configuredProviders(): { id: ProviderId; label: string }[] {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .filter(providerConfigured)
    .map((id) => ({ id, label: PROVIDERS[id].label }));
}

export function buildAuthUrl(id: ProviderId, state: string): string {
  const p = PROVIDERS[id];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId ?? "",
    redirect_uri: redirectUri(id),
    scope: p.scope,
    state,
    ...(p.authorizeParams ?? {}),
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(id: ProviderId, code: string): Promise<string> {
  const p = PROVIDERS[id];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(id),
    client_id: p.clientId ?? "",
    client_secret: p.clientSecret ?? "",
  });
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`${id} token ${res.status}`);
  const d = (await res.json()) as { access_token?: string; error?: string };
  if (!d.access_token) throw new Error(`${id} token: ${d.error ?? "no access_token"}`);
  return d.access_token;
}

export async function fetchProfile(id: ProviderId, accessToken: string): Promise<SocialProfile> {
  return PROVIDERS[id].fetchProfile(accessToken);
}
