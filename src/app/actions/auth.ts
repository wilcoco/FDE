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
  const company = String(formData.get("slug") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력하세요." };

  // Company is OPTIONAL. If given, match by slug OR name (case-insensitive);
  // otherwise consider every tenant this email belongs to and disambiguate by
  // the password itself. This removes the "unknown slug" login trap.
  let candidates;
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
    if (tenants.length === 0) {
      return { error: "해당 회사를 찾을 수 없습니다. 회사명 없이 이메일만으로도 로그인할 수 있어요." };
    }
    candidates = await prisma.user.findMany({
      where: { email, tenantId: { in: tenants.map((t) => t.id) } },
    });
  } else {
    candidates = await prisma.user.findMany({ where: { email } });
  }

  // keep only accounts that can log in and whose password matches
  const matches = [];
  for (const u of candidates) {
    if (u.status === "DISABLED" || !u.passwordHash) continue;
    if (await verifyPassword(password, u.passwordHash)) matches.push(u);
  }

  if (matches.length === 0) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }
  if (matches.length > 1) {
    return { error: "이 이메일이 여러 회사에 있습니다. 회사명(또는 식별자)을 함께 입력해 주세요." };
  }

  const user = matches[0];
  await startSession({ userId: user.id, tenantId: user.tenantId, role: user.role });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
