"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { startSession, endSession } from "@/lib/session";
import { createTenantWithOwner } from "@/lib/provisioning";

export interface FormState {
  error?: string;
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!companyName || !name || !email || password.length < 6) {
    return { error: "모든 항목을 입력하세요 (비밀번호 6자 이상)." };
  }

  const { tenant, user } = await createTenantWithOwner(companyName, {
    email,
    name,
    passwordHash: await hashPassword(password),
  });

  await startSession({ userId: user.id, tenantId: tenant.id, role: user.role });
  redirect("/dashboard");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return { error: "회사 식별자 또는 로그인 정보가 올바르지 않습니다." };

  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email },
  });
  if (
    !user ||
    user.status === "DISABLED" ||
    !user.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    return { error: "회사 식별자 또는 로그인 정보가 올바르지 않습니다." };
  }

  await startSession({ userId: user.id, tenantId: tenant.id, role: user.role });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
