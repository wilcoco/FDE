import { prisma } from "./db";
import type { Position, Prisma, User } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

const MAX_CHAIN = 12; // SMB org depth guard against cycles

type UserWithPosition = User & { position: Position | null };

/**
 * Walk the reporting line upward from a user: [직속 상사, 그 위, …].
 * Stops at the top, on a cycle, or at MAX_CHAIN.
 */
export async function managerChain(
  db: Db,
  userId: string,
): Promise<UserWithPosition[]> {
  const chain: UserWithPosition[] = [];
  const seen = new Set<string>([userId]);
  let current = await db.user.findUnique({
    where: { id: userId },
    include: { position: true },
  });

  while (current?.managerId && !seen.has(current.managerId) && chain.length < MAX_CHAIN) {
    seen.add(current.managerId);
    const mgr = (await db.user.findUnique({
      where: { id: current.managerId },
      include: { position: true },
    })) as UserWithPosition | null;
    if (!mgr) break;
    chain.push(mgr);
    current = mgr;
  }
  return chain;
}

const rankOf = (u: UserWithPosition) => u.position?.rank ?? 0;

/**
 * Org-chain approvers: walk up the reporting line.
 * - `targetRank`: stop after the first manager at/above this rank (inclusive).
 * - `levels`: take this many managers from the bottom.
 * - neither: the full chain (multi-step registration approval).
 */
export async function resolveOrgChain(
  db: Db,
  userId: string,
  opts: { targetRank?: number; levels?: number } = {},
): Promise<string[]> {
  const chain = await managerChain(db, userId);
  if (opts.targetRank != null) {
    const out: string[] = [];
    for (const m of chain) {
      out.push(m.id);
      if (rankOf(m) >= opts.targetRank) break;
    }
    return out;
  }
  if (opts.levels != null) return chain.slice(0, opts.levels).map((m) => m.id);
  return chain.map((m) => m.id);
}

/**
 * Cost-control approvers (전결규정): find the rank required to finalize this
 * amount, then walk up the reporting line collecting approvers until one meets
 * that rank (escalating to the top if no one does).
 */
export async function resolveAmountTier(
  db: Db,
  tenantId: string,
  userId: string,
  amount: number,
): Promise<string[]> {
  const rules = await db.approvalAuthorityRule.findMany({
    where: { tenantId },
    orderBy: { approverRank: "asc" },
  });
  // first tier whose ceiling covers the amount (null ceiling = unlimited)
  const tier =
    rules.find((r) => r.maxAmount == null || amount <= r.maxAmount) ??
    rules[rules.length - 1];
  const requiredRank = tier?.approverRank ?? 1;

  const chain = await managerChain(db, userId);
  const approvers: string[] = [];
  for (const m of chain) {
    approvers.push(m.id);
    if (rankOf(m) >= requiredRank) return approvers;
  }
  return approvers; // nobody met the rank → escalate to full chain
}
