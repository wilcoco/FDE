"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { startSession, endSession } from "@/lib/session";

export interface FormState {
  error?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base || "team";
  let i = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

const DEFAULT_POSITIONS = [
  { name: "사원", rank: 1 },
  { name: "대리", rank: 2 },
  { name: "과장", rank: 3 },
  { name: "팀장", rank: 4 },
  { name: "본부장", rank: 5 },
  { name: "대표", rank: 6 },
];

// 전결규정 기본값: 금액 구간별 필요 직급
const DEFAULT_RULES = [
  { maxAmount: 1_000_000, approverRank: 4, order: 0 }, // ~100만 → 팀장
  { maxAmount: 10_000_000, approverRank: 5, order: 1 }, // ~1000만 → 본부장
  { maxAmount: null, approverRank: 6, order: 2 }, // 초과 → 대표
];

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

  const slug = await uniqueSlug(slugify(companyName) || slugify(email.split("@")[0]));

  const created = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: companyName, slug },
    });
    // default org scaffolding
    const positions = await Promise.all(
      DEFAULT_POSITIONS.map((p) =>
        tx.position.create({ data: { tenantId: tenant.id, ...p } }),
      ),
    );
    await tx.approvalAuthorityRule.createMany({
      data: DEFAULT_RULES.map((r) => ({ tenantId: tenant.id, ...r })),
    });
    const dept = await tx.department.create({
      data: { tenantId: tenant.id, name: "본사" },
    });
    const ceo = positions.find((p) => p.rank === 6)!;
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        passwordHash: await hashPassword(password),
        role: "OWNER",
        status: "ACTIVE",
        departmentId: dept.id,
        positionId: ceo.id,
      },
    });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "TENANT_CREATED", target: tenant.id },
    });
    return { tenant, user };
  });

  await startSession({
    userId: created.user.id,
    tenantId: created.tenant.id,
    role: created.user.role,
  });
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
  if (!user || user.status === "DISABLED" || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "회사 식별자 또는 로그인 정보가 올바르지 않습니다." };
  }

  await startSession({ userId: user.id, tenantId: tenant.id, role: user.role });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
