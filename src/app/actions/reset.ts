"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { startSession } from "@/lib/session";
import { sendPasswordResetEmail } from "@/lib/mail";
import { consume, clientIp } from "@/lib/rate-limit";

export interface FormState {
  error?: string;
  ok?: boolean;
}

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Request a reset link. Always returns the same success message regardless of
 * whether the account exists, so the form can't be used to probe emails.
 */
export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const company = String(formData.get("slug") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "이메일을 입력하세요." };

  // mail-bomb guard: same success response either way (no enumeration signal),
  // but silently stop issuing tokens/emails past the limit
  const ipOk = consume("reset-ip", await clientIp(), 10, 60 * 60 * 1000).ok;
  const emailOk = consume("reset-email", email, 3, 60 * 60 * 1000).ok;
  if (!ipOk || !emailOk) return { ok: true };

  // Company is optional; reset every active account with this email (usually one).
  let where;
  if (company) {
    const tenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { slug: company.toLowerCase() },
          { name: { equals: company, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    where = { email, status: { not: "DISABLED" as const }, tenantId: { in: tenants.map((t) => t.id) } };
  } else {
    where = { email, status: { not: "DISABLED" as const } };
  }

  const users = await prisma.user.findMany({ where });
  for (const user of users) {
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomUUID() + randomUUID().replace(/-/g, "");
    await prisma.passwordResetToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await sendPasswordResetEmail(user.email, user.name, token);
  }

  return { ok: true };
}

/** Complete a reset: validate the token, set the new password, and sign in. */
export async function resetPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 6) return { error: "비밀번호는 6자 이상이어야 합니다." };
  if (password !== confirm) return { error: "비밀번호가 일치하지 않습니다." };

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "유효하지 않거나 만료된 링크입니다. 다시 요청해 주세요." };
  }

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await tx.auditLog.create({
      data: { tenantId: record.tenantId, actorId: u.id, action: "PASSWORD_RESET", target: u.id },
    });
    return u;
  });

  await startSession({ userId: user.id, tenantId: record.tenantId, role: user.role });
  redirect("/dashboard");
}
