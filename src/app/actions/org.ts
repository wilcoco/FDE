"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";

export async function addDepartment(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  if (!name) return;
  await prisma.department.create({ data: { tenantId: tenant.id, name, parentId } });
  revalidatePath("/org");
}

export async function setDepartmentHead(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const departmentId = String(formData.get("departmentId") ?? "");
  const headId = String(formData.get("headId") ?? "") || null;
  await prisma.department.updateMany({
    where: { id: departmentId, tenantId: tenant.id },
    data: { headId },
  });
  revalidatePath("/org");
}

export async function addPosition(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const rank = Number(formData.get("rank") ?? 1);
  if (!name) return;
  await prisma.position.create({ data: { tenantId: tenant.id, name, rank } });
  revalidatePath("/org");
}

export async function updateUserOrg(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const positionId = String(formData.get("positionId") ?? "") || null;
  const managerId = String(formData.get("managerId") ?? "") || null;
  if (managerId === userId) return; // no self-manager
  await prisma.user.updateMany({
    where: { id: userId, tenantId: tenant.id },
    data: { departmentId, positionId, managerId },
  });
  revalidatePath("/org");
}

export async function addAuthorityRule(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const maxRaw = String(formData.get("maxAmount") ?? "").trim();
  const maxAmount = maxRaw === "" ? null : Number(maxRaw);
  const approverRank = Number(formData.get("approverRank") ?? 1);
  const count = await prisma.approvalAuthorityRule.count({ where: { tenantId: tenant.id } });
  await prisma.approvalAuthorityRule.create({
    data: { tenantId: tenant.id, maxAmount, approverRank, order: count },
  });
  revalidatePath("/org");
}

export async function deleteAuthorityRule(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.approvalAuthorityRule.deleteMany({ where: { id, tenantId: tenant.id } });
  revalidatePath("/org");
}

export async function setDirectiveRestriction(formData: FormData) {
  const { tenant } = await requireRole("OWNER");
  const restricted = formData.get("restricted") === "on";
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { directiveRestrictedToSuperior: restricted },
  });
  revalidatePath("/org");
}
