import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getCurrentContext } from "@/lib/session";
import { gmailAuthorizeUrl, gmailOAuthConfigured } from "@/lib/gmail";

// GET /api/mail/google — kick off the Gmail OAuth consent flow.
export async function GET(req: Request) {
  const ctx = await getCurrentContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!gmailOAuthConfigured()) return NextResponse.redirect(new URL("/mail?error=gmail_unconfigured", req.url));

  const state = randomUUID();
  const jar = await cookies();
  jar.set("gmail_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(gmailAuthorizeUrl(state));
}
