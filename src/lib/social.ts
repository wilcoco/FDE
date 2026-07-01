import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import type { Prisma, Tenant, User } from "@prisma/client";
import type { ProviderId, SocialProfile } from "./oauth";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me",
);

// ── pending-signup token (carries a verified social profile to /auth/complete) ─

export interface PendingSignup {
  provider: ProviderId;
  sub: string;
  email: string;
  name: string;
  orgId?: string;
  orgName?: string;
}

export async function signPending(p: PendingSignup): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(SECRET);
}

export async function verifyPending(token: string): Promise<PendingSignup | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.provider === "string" && typeof payload.sub === "string") {
      return payload as unknown as PendingSignup;
    }
    return null;
  } catch {
    return null;
  }
}

// ── resolution ────────────────────────────────────────────────────────────────

export type Resolution =
  | { kind: "login"; user: User; tenant: Tenant }
  | { kind: "pending"; pending: PendingSignup };

async function findTenantByOrg(
  provider: ProviderId,
  orgId?: string,
): Promise<Tenant | null> {
  if (!orgId) return null;
  if (provider === "google") return prisma.tenant.findUnique({ where: { googleDomain: orgId } });
  if (provider === "slack") return prisma.tenant.findUnique({ where: { slackTeamId: orgId } });
  return null;
}

/**
 * Resolve a verified social profile to an existing account, or signal that a
 * first-time signup is needed.
 *
 * Order:
 *  1. Already linked (authProvider + authSub) → log in.
 *  2. Org auto-join (Google Workspace domain / Slack team id maps to a tenant):
 *     link an existing same-email user, else create an ACTIVE MEMBER.
 *  3. Otherwise → pending: the user names/creates their own company.
 */
export async function resolveSocial(
  provider: ProviderId,
  profile: SocialProfile,
): Promise<Resolution> {
  // 1. linked account
  const linked = await prisma.user.findFirst({
    where: { authProvider: provider, authSub: profile.sub } as Prisma.UserWhereInput,
    include: { tenant: true },
  });
  if (linked && linked.status !== "DISABLED") {
    const { tenant, ...user } = linked;
    return { kind: "login", user: user as User, tenant };
  }

  // 2. org auto-join
  const tenant = await findTenantByOrg(provider, profile.orgId);
  if (tenant) {
    if (profile.email) {
      const existing = await prisma.user.findFirst({
        where: { tenantId: tenant.id, email: profile.email },
      });
      if (existing) {
        if (existing.status === "DISABLED") return { kind: "pending", pending: toPending(provider, profile) };
        const user = await prisma.user.update({
          where: { id: existing.id },
          data: { authProvider: provider, authSub: profile.sub } as Prisma.UserUncheckedUpdateInput,
        });
        return { kind: "login", user, tenant };
      }
    }
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: profile.email || `${provider}_${profile.sub}@no-email.local`,
        name: profile.name,
        role: "MEMBER",
        status: "ACTIVE",
        authProvider: provider,
        authSub: profile.sub,
      } as Prisma.UserUncheckedCreateInput,
    });
    await prisma.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "JOINED_VIA_SOCIAL", target: provider },
    });
    return { kind: "login", user, tenant };
  }

  // 3. first-time signup — user creates their own company
  return { kind: "pending", pending: toPending(provider, profile) };
}

function toPending(provider: ProviderId, profile: SocialProfile): PendingSignup {
  return {
    provider,
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
    orgId: profile.orgId,
    orgName: profile.orgName,
  };
}
