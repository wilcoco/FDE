import { prisma } from "./db";

/**
 * Tenant-scoped data access.
 *
 * Every query that touches tenant-owned data MUST go through a scope bound to a
 * single tenantId. This is what enforces the "walls between groups" guarantee
 * AND what keeps each tenant self-contained for later extraction: there is no
 * code path that reads across tenants by accident.
 *
 * Usage:
 *   const db = tenantScope(ctx.tenant.id);
 *   const instances = await db.instances({ where: { status: "RUNNING" } });
 */
export function tenantScope(tenantId: string) {
  // Merge a caller's `where` with the mandatory tenant filter.
  const scoped = <T extends { where?: Record<string, unknown> }>(args?: T) =>
    ({
      ...args,
      where: { ...(args?.where ?? {}), tenantId },
    }) as T & { where: { tenantId: string } };

  return {
    tenantId,

    users: (args?: Parameters<typeof prisma.user.findMany>[0]) =>
      prisma.user.findMany(scoped(args)),

    definitions: (args?: Parameters<typeof prisma.processDefinition.findMany>[0]) =>
      prisma.processDefinition.findMany(scoped(args)),

    instances: (args?: Parameters<typeof prisma.processInstance.findMany>[0]) =>
      prisma.processInstance.findMany(scoped(args)),

    nodeRuns: (args?: Parameters<typeof prisma.nodeInstance.findMany>[0]) =>
      prisma.nodeInstance.findMany(scoped(args)),

    auditLogs: (args?: Parameters<typeof prisma.auditLog.findMany>[0]) =>
      prisma.auditLog.findMany(scoped(args)),

    /** Fetch one tenant-owned record, guaranteed not to leak across tenants. */
    instance: (id: string) =>
      prisma.processInstance.findFirst({ where: { id, tenantId } }),

    definition: (id: string) =>
      prisma.processDefinition.findFirst({ where: { id, tenantId } }),

    /** Append an entry to the tenant's audit trail. */
    audit: (entry: {
      actorId?: string;
      action: string;
      target?: string;
      meta?: Record<string, unknown>;
    }) =>
      prisma.auditLog.create({
        data: {
          tenantId,
          actorId: entry.actorId,
          action: entry.action,
          target: entry.target,
          meta: entry.meta ?? {},
        },
      }),
  };
}

export type TenantScope = ReturnType<typeof tenantScope>;
