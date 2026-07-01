import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import {
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./auth";
import { atLeast } from "./rbac";
import type { Role, Tenant, User } from "@prisma/client";

const COOKIE_NAME = "fd_session";

export async function startSession(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export interface AuthContext {
  user: User;
  tenant: Tenant;
}

/**
 * Resolve the current user + tenant, or null if not authenticated.
 * Always re-reads from the DB so role/status changes take effect immediately.
 */
export async function getCurrentContext(): Promise<AuthContext | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.userId, tenantId: session.tenantId },
    include: { tenant: true },
  });

  if (!user || user.status === "DISABLED") return null;
  const { tenant, ...rest } = user;
  return { user: rest as User, tenant };
}

/** Use in any authenticated page/action; redirects to /login if missing. */
export async function requireContext(): Promise<AuthContext> {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Require the current user to hold at least one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await requireContext();
  // Role is hierarchical: a higher role satisfies a lower requirement.
  // requireRole("ADMIN") therefore also admits OWNER.
  if (!roles.some((min) => atLeast(ctx.user.role, min))) {
    redirect("/dashboard?error=forbidden");
  }
  return ctx;
}
