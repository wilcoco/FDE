"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { startSession } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import type { Role } from "@prisma/client";

export interface FormState {
  error?: string;
}

const INVITE_TTL_DAYS = 7;

/** Admin creates an invitation; the returned token forms the invite link. */
export async function createInvitation(formData: FormData) {
  const { tenant, user } = await requireRole("ADMIN");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = (String(formData.get("role") ?? "MEMBER") as Role) || "MEMBER";
  if (!email) return;

  const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
  if (existing) return; // already a member

  // reuse a still-pending invite for the same email if present
  const pending = await prisma.invitation.findFirst({
    where: { tenantId: tenant.id, email, acceptedAt: null },
  });
  if (pending) {
    await prisma.invitation.update({
      where: { id: pending.id },
      data: { role, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000) },
    });
  } else {
    await prisma.invitation.create({
      data: {
        tenantId: tenant.id,
        email,
        role,
        token: randomUUID(),
        invitedById: user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000),
      },
    });
  }
  revalidatePath("/members");
}

export async function revokeInvitation(formData: FormData) {
  const { tenant } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.invitation.deleteMany({ where: { id, tenantId: tenant.id, acceptedAt: null } });
  revalidatePath("/members");
}

/** Public: invitee accepts via token, sets name + password, and is logged in. */
export async function acceptInvitation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || password.length < 6) return { error: "이름과 비밀번호(6자 이상)를 입력하세요." };

  const invite = await prisma.invitation.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return { error: "유효하지 않거나 만료된 초대입니다." };
  }
  const dup = await prisma.user.findFirst({ where: { tenantId: invite.tenantId, email: invite.email } });
  if (dup) return { error: "이미 가입된 이메일입니다. 로그인하세요." };

  const created = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        tenantId: invite.tenantId,
        email: invite.email,
        name,
        role: invite.role,
        status: "ACTIVE",
        passwordHash: await hashPassword(password),
      },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    await tx.auditLog.create({ data: { tenantId: invite.tenantId, actorId: u.id, action: "INVITE_ACCEPTED", target: u.id } });
    return u;
  });

  await startSession({ userId: created.id, tenantId: invite.tenantId, role: created.role });
  redirect("/dashboard");
}
