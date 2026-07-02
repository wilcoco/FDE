"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { notify, notifyEmail } from "@/lib/notify";
import { sendNotificationEmail } from "@/lib/mail";
import { consume, clientIp, retryMinutes } from "@/lib/rate-limit";

export interface FormState {
  error?: string;
  ok?: boolean;
}

export interface CompanyHit {
  id: string;
  name: string;
  slug: string;
}

/** Public: find companies by name/slug so a newcomer can request to join. */
export async function searchCompanies(query: string): Promise<CompanyHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hits = await prisma.tenant.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return hits;
}

/** Notify every active owner/admin of a tenant. */
async function notifyAdmins(
  tenantId: string,
  entry: { type: string; title: string; body?: string; link?: string },
) {
  const admins = await prisma.user.findMany({
    where: { tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  await Promise.all(admins.map((a) => notify(prisma, { tenantId, userId: a.id, ...entry })));
  for (const a of admins) {
    void notifyEmail({ tenantId, userId: a.id, ...entry }).catch(() => {});
  }
}

/** Public: submit a request to join an existing company (pending approval). */
export async function requestToJoin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!tenantId) return { error: "가입할 회사를 먼저 선택하세요." };
  if (!name || !email || password.length < 6) {
    return { error: "이름·이메일·비밀번호(6자 이상)를 입력하세요." };
  }

  const rl = consume("join-req", await clientIp(), 10, 60 * 60 * 1000);
  if (!rl.ok) {
    return { error: `요청이 너무 많습니다. ${retryMinutes(rl)}분 후 다시 시도하세요.` };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { error: "선택한 회사를 찾을 수 없습니다." };

  const existingUser = await prisma.user.findFirst({ where: { tenantId, email } });
  if (existingUser) return { error: "이미 이 회사에 가입된 이메일입니다. 로그인하세요." };

  const passwordHash = await hashPassword(password);
  const pending = await prisma.joinRequest.findFirst({
    where: { tenantId, email, status: "PENDING" },
  });
  if (pending) {
    await prisma.joinRequest.update({
      where: { id: pending.id },
      data: { name, passwordHash },
    });
  } else {
    await prisma.joinRequest.create({
      data: { tenantId, email, name, passwordHash, status: "PENDING" },
    });
  }

  await notifyAdmins(tenantId, {
    type: "JOIN_REQUEST",
    title: "새 가입 요청",
    body: `${name} (${email}) 님이 가입을 요청했습니다.`,
    link: "/members",
  });

  return { ok: true };
}

/** Admin: approve a pending request — creates the member and notifies them. */
export async function approveJoinRequest(formData: FormData) {
  const { tenant, user: admin } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");

  const req = await prisma.joinRequest.findFirst({
    where: { id, tenantId: tenant.id, status: "PENDING" },
  });
  if (!req) return;

  const dup = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: req.email } });
  await prisma.$transaction(async (tx) => {
    if (!dup) {
      const created = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: req.email,
          name: req.name,
          role: "MEMBER",
          status: "ACTIVE",
          passwordHash: req.passwordHash,
        },
      });
      await notify(tx, {
        tenantId: tenant.id,
        userId: created.id,
        type: "JOIN_APPROVED",
        title: "가입이 승인되었습니다",
        body: `${tenant.name}의 구성원으로 승인되었습니다. 로그인하세요.`,
        link: "/dashboard",
      });
    }
    await tx.joinRequest.update({
      where: { id: req.id },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: admin.id },
    });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: admin.id, action: "JOIN_REQUEST_APPROVED", target: req.email },
    });
  });

  void sendNotificationEmail(req.email, {
    title: `${tenant.name} 가입이 승인되었습니다`,
    body: "이메일과 가입 시 정한 비밀번호로 로그인하세요.",
    link: "/login",
  }).catch(() => {});

  revalidatePath("/members");
  revalidatePath("/org");
}

/** Admin: reject a pending request. */
export async function rejectJoinRequest(formData: FormData) {
  const { tenant, user: admin } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await prisma.joinRequest.updateMany({
    where: { id, tenantId: tenant.id, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date(), decidedById: admin.id },
  });
  revalidatePath("/members");
}
