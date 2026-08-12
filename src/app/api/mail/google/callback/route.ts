import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentContext } from "@/lib/session";
import { exchangeCode, emailFromIdToken } from "@/lib/gmail";
import { encryptSecret } from "@/lib/crypto";
import { appUrl } from "@/lib/app-url";

// GET /api/mail/google/callback — Google redirects here with ?code&state.
export async function GET(req: Request) {
  const ctx = await getCurrentContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", appUrl()));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("gmail_oauth_state")?.value;
  jar.delete("gmail_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/mail?error=oauth_state", appUrl()));
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // user re-consented without offline grant — extremely rare with prompt=consent
      return NextResponse.redirect(new URL("/mail?error=oauth_norefresh", appUrl()));
    }
    const email = (tokens.id_token && emailFromIdToken(tokens.id_token)) || ctx.user.email;

    await prisma.mailConnection.upsert({
      where: { userId: ctx.user.id },
      create: {
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        provider: "gmail",
        host: "gmail.googleapis.com",
        port: 993, // unused for gmail; kept sane for capability display
        email,
        encPass: encryptSecret("oauth"), // unused for gmail; column is required
        encRefresh: encryptSecret(tokens.refresh_token),
      },
      update: {
        provider: "gmail",
        host: "gmail.googleapis.com",
        email,
        encRefresh: encryptSecret(tokens.refresh_token),
      },
    });
    await prisma.auditLog.create({
      data: { tenantId: ctx.tenant.id, actorId: ctx.user.id, action: "MAIL_CONNECTED_GMAIL", target: email },
    });
    return NextResponse.redirect(new URL("/mail?connected=gmail", appUrl()));
  } catch (e) {
    console.error("[gmail oauth] callback failed", e);
    return NextResponse.redirect(new URL("/mail?error=oauth_exchange", appUrl()));
  }
}
