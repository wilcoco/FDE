"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { atLeast } from "@/lib/rbac";
import { notify, notifyEmail } from "@/lib/notify";
import { parseMentions, commentRecipients } from "@/lib/collab";
import type { Prisma } from "@prisma/client";

const MAX_LEN = 4000;

/** Post a collaboration note on an instruction (milestoneId optional). */
export async function addComment(formData: FormData) {
  const { tenant, user } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const milestoneId = String(formData.get("milestoneId") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_LEN);
  if (!body) return;

  const inst = await prisma.instruction.findFirst({
    where: { id: instructionId, tenantId: tenant.id },
    select: { id: true, authorId: true, summary: true },
  });
  if (!inst) return;

  let milestone: { id: string; title: string; ownerId: string | null } | null = null;
  if (milestoneId) {
    milestone = await prisma.milestone.findFirst({
      where: { id: milestoneId, tenantId: tenant.id, instructionId },
      select: { id: true, title: true, ownerId: true },
    });
    if (!milestone) return; // milestone must belong to this instruction
  }

  const members = await prisma.user.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const mentionedIds = parseMentions(body, members);

  const priorCommenters = await prisma.milestoneComment.findMany({
    where: { tenantId: tenant.id, instructionId, milestoneId },
    select: { authorId: true },
    distinct: ["authorId"],
  });

  await prisma.milestoneComment.create({
    data: {
      tenantId: tenant.id,
      instructionId,
      milestoneId,
      authorId: user.id,
      body,
      mentions: mentionedIds as Prisma.InputJsonValue,
    },
  });

  const { thread, mentioned } = commentRecipients({
    authorId: user.id,
    ownerId: milestone?.ownerId ?? null,
    instructionAuthorId: inst.authorId,
    priorCommenterIds: priorCommenters.map((c) => c.authorId),
    mentionedIds,
  });

  const where = milestone ? `꼭지 “${milestone.title}”` : inst.summary || "지시";
  const link = `/instructions/${instructionId}${milestone ? `#c-${milestone.id}` : ""}`;
  const preview = body.length > 120 ? body.slice(0, 120) + "…" : body;

  // mentioned people get a stronger, always-relevant notification
  for (const uid of mentioned) {
    const entry = {
      tenantId: tenant.id, userId: uid, type: "COMMENT_MENTION",
      title: `💬 ${user.name} 님이 회원님을 언급했습니다`,
      body: `${where}: ${preview}`,
      link,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
  }
  for (const uid of thread) {
    const entry = {
      tenantId: tenant.id, userId: uid, type: "COMMENT_NEW",
      title: `💬 새 협업 노트: ${where}`,
      body: `${user.name}: ${preview}`,
      link,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
  }

  revalidatePath(`/instructions/${instructionId}`);
}

/** Delete own comment (or any comment if admin/owner). */
export async function deleteComment(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const c = await prisma.milestoneComment.findFirst({
    where: { id, tenantId: tenant.id },
    select: { authorId: true, instructionId: true },
  });
  if (!c) return;
  if (c.authorId !== user.id && !atLeast(user.role, "ADMIN")) return;
  await prisma.milestoneComment.delete({ where: { id } });
  revalidatePath(`/instructions/${c.instructionId}`);
}
