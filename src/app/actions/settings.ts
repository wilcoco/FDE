"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { CATEGORIES } from "@/lib/notify-prefs";
import type { Prisma } from "@prisma/client";

/** Save per-category notification channel preferences for the current user. */
export async function saveNotifyPrefs(formData: FormData) {
  const { user } = await requireContext();

  const prefs: Record<string, { inapp: boolean; email: boolean }> = {};
  for (const c of CATEGORIES) {
    prefs[c.key] = {
      inapp: formData.get(`${c.key}_inapp`) === "on",
      email: formData.get(`${c.key}_email`) === "on",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { notifyPrefs: prefs as Prisma.InputJsonValue },
  });
  revalidatePath("/settings");
}
