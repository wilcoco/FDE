import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, fetchProfile, isProvider, providerConfigured } from "@/lib/oauth";
import { resolveSocial, signPending } from "@/lib/social";
import { createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

function appBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

// GET /api/auth/:provider/callback — provider redirects here with ?code&state.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const base = appBase();
  if (!isProvider(provider) || !providerConfigured(provider)) {
    return NextResponse.redirect(new URL("/login?error=provider", base));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return NextResponse.redirect(new URL("/login?error=denied", base));

  const store = await cookies();
  const expected = store.get("fd_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/login?error=state", base));
  }

  try {
    const accessToken = await exchangeCode(provider, code);
    const profile = await fetchProfile(provider, accessToken);
    const result = await resolveSocial(provider, profile);

    if (result.kind === "login") {
      const token = await createSessionToken({
        userId: result.user.id,
        tenantId: result.tenant.id,
        role: result.user.role,
      });
      const res = NextResponse.redirect(new URL("/dashboard", base));
      res.cookies.set("fd_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
      res.cookies.delete("fd_oauth_state");
      return res;
    }

    // first-time: stash a signed profile and send to the company-naming step
    const pending = await signPending(result.pending);
    const res = NextResponse.redirect(new URL("/complete", base));
    res.cookies.set("fd_pending", pending, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    res.cookies.delete("fd_oauth_state");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", base));
  }
}
