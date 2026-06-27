"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import type { Role } from "@prisma/client";

export async function addMember(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = (String(formData.get("role") ?? "MEMBER") as Role) || "MEMBER";
  if (!name || !email || password.length < 6) return;

  const exists = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
  if (exists) return;

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name,
      email,
      role,
      status: "ACTIVE",
      passwordHash: await hashPassword(password),
    },
  });
  revalidatePath("/members");
  revalidatePath("/org");
}

export async function setMemberStatus(formData: FormData) {
  const { tenant, user } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "ACTIVE") as "ACTIVE" | "DISABLED";
  if (userId === user.id) return; // can't disable self
  await prisma.user.updateMany({
    where: { id: userId, tenantId: tenant.id },
    data: { status },
  });
  revalidatePath("/members");
}

export async function setMemberRole(formData: FormData) {
  const { tenant } = await requireRole("OWNER");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "MEMBER") as Role;
  await prisma.user.updateMany({
    where: { id: userId, tenantId: tenant.id },
    data: { role },
  });
  revalidatePath("/members");
}
