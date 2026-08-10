import { prisma } from "./db";
import type { Prisma, Tenant, User } from "@prisma/client";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export async function uniqueSlug(base: string): Promise<string> {
  const root = base || "team";
  let slug = root;
  let i = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${root}-${i++}`;
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

export interface OwnerInput {
  email: string;
  name: string;
  passwordHash?: string | null;
  authProvider?: string | null;
  authSub?: string | null;
}

export interface TenantOrgBinding {
  googleDomain?: string | null;
  slackTeamId?: string | null;
}

/**
 * Create a new company (tenant) with default org scaffolding and its OWNER.
 * Used by both password signup and social first-time company creation.
 */
export async function createTenantWithOwner(
  companyName: string,
  owner: OwnerInput,
  org: TenantOrgBinding = {},
): Promise<{ tenant: Tenant; user: User }> {
  const slug = await uniqueSlug(slugify(companyName) || slugify(owner.email.split("@")[0]));

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: companyName,
        slug,
        googleDomain: org.googleDomain ?? null,
        slackTeamId: org.slackTeamId ?? null,
      } as Prisma.TenantUncheckedCreateInput,
    });
    const positions = await Promise.all(
      DEFAULT_POSITIONS.map((p) => tx.position.create({ data: { tenantId: tenant.id, ...p } })),
    );
    await tx.approvalAuthorityRule.createMany({
      data: DEFAULT_RULES.map((r) => ({ tenantId: tenant.id, ...r })),
    });
    const dept = await tx.department.create({ data: { tenantId: tenant.id, name: "본사" } });
    const ceo = positions.find((p) => p.rank === 6)!;
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: owner.email,
        name: owner.name,
        passwordHash: owner.passwordHash ?? null,
        authProvider: owner.authProvider ?? null,
        authSub: owner.authSub ?? null,
        role: "OWNER",
        status: "ACTIVE",
        departmentId: dept.id,
        positionId: ceo.id,
      } as Prisma.UserUncheckedCreateInput,
    });
    // seed one sample instruction so the first screen isn't empty — a founder
    // sees the say→do→verify shape immediately instead of a blank dashboard.
    const sample = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText: SAMPLE_INSTRUCTION.rawText,
        summary: SAMPLE_INSTRUCTION.summary,
        source: "TEXT",
      },
    });
    await tx.milestone.createMany({
      data: SAMPLE_INSTRUCTION.milestones.map((m, i) => ({
        tenantId: tenant.id,
        instructionId: sample.id,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult,
        status: (i === 0 ? "ACTIVE" : "PENDING") as Prisma.MilestoneCreateManyInput["status"],
        activatedAt: i === 0 ? new Date() : null,
        proof: [] as Prisma.InputJsonValue,
      })),
    });

    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "TENANT_CREATED", target: tenant.id },
    });
    return { tenant, user };
  });
}

/** Example instruction seeded into every new company — teaches the shape. */
const SAMPLE_INSTRUCTION = {
  rawText:
    "[예시] 이건 FlowDesk 사용법을 보여주는 샘플 지시입니다. 실제 지시는 왼쪽 위 '＋ 지시하기'로 만드세요. — 다음 주까지 신제품 브로슈어 초안 잡고, 인쇄소 견적 세 곳 받아서 비교해줘.",
  summary: "[예시] 신제품 브로슈어 준비 — 초안 + 인쇄 견적 비교",
  milestones: [
    { title: "브로슈어 초안 작성", expectedResult: "핵심 메시지·이미지 배치가 담긴 1차 시안" },
    { title: "인쇄소 견적 3곳 확보", expectedResult: "업체명·단가·납기가 정리된 비교표" },
    { title: "비교 후 최종 발주", expectedResult: "선정 사유와 발주 확정" },
  ],
};
