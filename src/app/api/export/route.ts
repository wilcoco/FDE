import { requireContext } from "@/lib/session";
import { atLeast } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * Full-tenant data export (JSON), admin-only. The "exit door" we promised:
 * your data is yours, downloadable at any time. Secrets (password hashes,
 * reset tokens) are never included.
 */
export async function GET() {
  const { tenant, user } = await requireContext();
  if (!atLeast(user.role, "ADMIN")) {
    return new Response("권한이 없습니다 (관리자 전용)", { status: 403 });
  }

  const [members, instructions, objectives, goals, syntheses] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true, name: true, email: true, role: true, status: true,
        department: { select: { name: true } },
        position: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.instruction.findMany({
      where: { tenantId: tenant.id },
      include: {
        author: { select: { name: true, email: true } },
        parentMilestone: { select: { id: true, title: true } },
        milestones: {
          orderBy: { order: "asc" },
          include: {
            owner: { select: { name: true, email: true } },
            dataTables: { include: { rows: { orderBy: { createdAt: "asc" } } } },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.objective.findMany({
      where: { tenantId: tenant.id },
      include: { keyResults: true, owner: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.goal.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } }),
    prisma.strategySynthesis.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, result: true, createdAt: true },
    }),
  ]);

  const payload = {
    format: "flowdesk-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: { name: user.name, email: user.email },
    tenant: { name: tenant.name, slug: tenant.slug, createdAt: tenant.createdAt },
    members,
    instructions,
    objectives,
    goals,
    strategySyntheses: syntheses,
  };

  const date = new Date().toISOString().slice(0, 10);
  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorId: user.id, action: "TENANT_EXPORT", target: tenant.id },
  });

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="flowdesk-export-${tenant.slug}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
