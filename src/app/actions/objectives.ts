"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole, requireContext } from "@/lib/session";
import type { ObjectiveLevel, ObjectiveType } from "@prisma/client";

export async function addObjective(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await prisma.objective.create({
    data: {
      tenantId: tenant.id,
      title,
      description: String(formData.get("description") ?? "") || null,
      type: (String(formData.get("type") ?? "OKR") as ObjectiveType),
      level: (String(formData.get("level") ?? "COMPANY") as ObjectiveLevel),
      period: String(formData.get("period") ?? "") || null,
      parentId: String(formData.get("parentId") ?? "") || null,
      ownerId: String(formData.get("ownerId") ?? "") || null,
    },
  });
  revalidatePath("/objectives");
}

export async function addKeyResult(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const objectiveId = String(formData.get("objectiveId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!objectiveId || !title) return;
  await prisma.keyResult.create({
    data: {
      tenantId: tenant.id,
      objectiveId,
      title,
      metric: String(formData.get("metric") ?? "") || null,
      unit: String(formData.get("unit") ?? "") || null,
      targetValue: Number(formData.get("targetValue") ?? 0),
      currentValue: Number(formData.get("currentValue") ?? 0),
    },
  });
  revalidatePath("/objectives");
}

export async function updateKeyResultProgress(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  await prisma.keyResult.updateMany({
    where: { id, tenantId: tenant.id },
    data: { currentValue: Number(formData.get("currentValue") ?? 0) },
  });
  revalidatePath("/objectives");
}

export async function addGoal(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await prisma.goal.create({
    data: {
      tenantId: tenant.id,
      title,
      description: String(formData.get("description") ?? "") || null,
      objectiveId: String(formData.get("objectiveId") ?? "") || null,
      ownerId: String(formData.get("ownerId") ?? "") || null,
    },
  });
  revalidatePath("/objectives");
}
