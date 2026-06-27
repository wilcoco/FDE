import type { Role } from "@prisma/client";

/**
 * Coarse role capabilities. Fine-grained, per-process authority is resolved
 * through the org chart + approval module; this gates admin-surface actions.
 */
const RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const can = {
  manageOrg: (r: Role) => atLeast(r, "ADMIN"),
  manageMembers: (r: Role) => atLeast(r, "ADMIN"),
  manageObjectives: (r: Role) => atLeast(r, "ADMIN"),
  authorProcess: (r: Role) => atLeast(r, "MEMBER"),
  manageTenant: (r: Role) => atLeast(r, "OWNER"),
};
