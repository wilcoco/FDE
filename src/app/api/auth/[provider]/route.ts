import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAuthUrl, isProvider, providerConfigured } from "@/lib/oauth";

export const runtime = "nodejs";

// GET /api/auth/:provider — begin the OAuth flow.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isProvider(provider) || !providerConfigured(provider)) {
    return NextResponse.redirect(new URL("/login?error=provider", appBase()));
  }

  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(provider, state));
  // CSRF protection: state is echoed back and compared against this cookie.
  res.cookies.set("fd_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

function appBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}
