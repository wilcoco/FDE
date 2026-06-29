import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const slug = "acme";
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    console.log("Demo tenant already exists — skipping seed.");
    return;
  }

  const hash = (p: string) => bcrypt.hash(p, 10);

  const tenant = await prisma.tenant.create({ data: { name: "아크미 주식회사", slug } });

  const positions = await Promise.all(
    [
      { name: "사원", rank: 1 }, { name: "대리", rank: 2 }, { name: "과장", rank: 3 },
      { name: "팀장", rank: 4 }, { name: "본부장", rank: 5 }, { name: "대표", rank: 6 },
    ].map((p) => prisma.position.create({ data: { tenantId: tenant.id, ...p } })),
  );
  const rank = (r: number) => positions.find((p) => p.rank === r)!.id;

  await prisma.approvalAuthorityRule.createMany({
    data: [
      { tenantId: tenant.id, maxAmount: 1_000_000, approverRank: 4, order: 0 },
      { tenantId: tenant.id, maxAmount: 10_000_000, approverRank: 5, order: 1 },
      { tenantId: tenant.id, maxAmount: null, approverRank: 6, order: 2 },
    ],
  });

  const hq = await prisma.department.create({ data: { tenantId: tenant.id, name: "본사" } });
  const sales = await prisma.department.create({ data: { tenantId: tenant.id, name: "영업팀", parentId: hq.id } });

  const ceo = await prisma.user.create({
    data: { tenantId: tenant.id, name: "김대표", email: "ceo@acme.com", passwordHash: await hash("password"), role: "OWNER", departmentId: hq.id, positionId: rank(6) },
  });
  const lead = await prisma.user.create({
    data: { tenantId: tenant.id, name: "이팀장", email: "lead@acme.com", passwordHash: await hash("password"), role: "ADMIN", departmentId: sales.id, positionId: rank(4), managerId: ceo.id },
  });
  const staff = await prisma.user.create({
    data: { tenantId: tenant.id, name: "박사원", email: "staff@acme.com", passwordHash: await hash("password"), role: "MEMBER", departmentId: sales.id, positionId: rank(1), managerId: lead.id },
  });
  await prisma.department.update({ where: { id: sales.id }, data: { headId: lead.id } });

  // OKR + KR
  const obj = await prisma.objective.create({
    data: { tenantId: tenant.id, type: "OKR", level: "COMPANY", title: "분기 매출 성장", period: "2026-Q3", ownerId: ceo.id, description: "신규 고객 확보로 매출 20% 성장" },
  });
  await prisma.keyResult.create({ data: { tenantId: tenant.id, objectiveId: obj.id, title: "신규 계약 30건", metric: "계약 수", targetValue: 30, currentValue: 12, unit: "건" } });
  const goal = await prisma.goal.create({ data: { tenantId: tenant.id, title: "비품/영업 지원 프로세스 정비", objectiveId: obj.id, ownerId: lead.id } });

  // ACTIVE process definition: 비품 구매
  const def = await prisma.processDefinition.create({
    data: {
      tenantId: tenant.id, name: "비품 구매 요청", description: "비품 신청 → 팀장 결재 → 발주 → 완료",
      goalId: goal.id, status: "ACTIVE", createdById: lead.id,
      sourceManual: "직원이 비품을 신청하면 팀장이 결재하고, 구매 담당자가 발주한 뒤 완료한다.",
      formSchema: [{ key: "item", label: "품목", type: "text" }, { key: "amount", label: "금액", type: "number" }],
    },
  });
  const mk = (key: string, type: string, name: string, extra: object = {}) =>
    prisma.processNode.create({ data: { tenantId: tenant.id, definitionId: def.id, key, type: type as never, name, ...extra } });
  await mk("start", "START", "시작");
  await mk("apply", "TASK", "비품 신청", { config: { assignee: { kind: "RUNTIME_INPUT", description: "신청자" } } });
  await mk("approve", "APPROVAL", "팀장 결재", { approvalKind: "GENERAL", config: { assignee: { kind: "ORG_RELATIVE", relation: "MANAGER", levels: 1 } } });
  await mk("order", "TASK", "발주", { config: { assignee: { kind: "RUNTIME_INPUT", description: "구매 담당" } } });
  await mk("end", "END", "종료");
  const nodes = await prisma.processNode.findMany({ where: { definitionId: def.id } });
  const byKey = new Map(nodes.map((n) => [n.key, n.id]));
  const edge = (f: string, t: string, order: number) =>
    prisma.processEdge.create({ data: { tenantId: tenant.id, definitionId: def.id, fromNodeId: byKey.get(f)!, toNodeId: byKey.get(t)!, order } });
  await edge("start", "apply", 0);
  await edge("apply", "approve", 1);
  await edge("approve", "order", 2);
  await edge("order", "end", 3);

  // a running instance to populate analytics
  const { startInstance, completeTask } = await import("../src/lib/engine");
  const inst = await startInstance({
    tenantId: tenant.id, definitionId: def.id, title: "노트북 구매 요청",
    data: { item: "노트북", amount: 1_500_000 }, initiatorId: staff.id,
    assignments: { apply: staff.id, order: lead.id },
  });
  const applyRun = await prisma.nodeInstance.findFirst({ where: { instanceId: inst.id, nodeKey: "apply" } });
  if (applyRun) {
    await prisma.workLog.create({ data: { tenantId: tenant.id, nodeInstanceId: applyRun.id, authorId: staff.id, content: "노트북 1대 신청합니다.", status: "SUBMITTED" } });
    await completeTask({ tenantId: tenant.id, nodeRunId: applyRun.id, userId: staff.id });
  }

  // flagship: a CEO instruction → coarse milestones (꼭지)
  const instruction = await prisma.instruction.create({
    data: {
      tenantId: tenant.id, authorId: ceo.id, source: "TEXT",
      objectiveId: obj.id,
      rawText: "다음 달 신제품 출시 준비해. 마케팅은 홍보안 잡고, 영업은 주요 거래처 사전 영업 돌리고, 생산은 초도 물량 확보해서 출시일 맞춰줘.",
      summary: "신제품 출시 준비",
    },
  });
  await prisma.milestone.createMany({
    data: [
      { tenantId: tenant.id, instructionId: instruction.id, order: 0, title: "마케팅 홍보안 확정", expectedResult: "출시 홍보안 1부 승인", ownerId: lead.id, status: "ACTIVE", activatedAt: new Date() },
      { tenantId: tenant.id, instructionId: instruction.id, order: 1, title: "주요 거래처 사전 영업", expectedResult: "10개 거래처 사전 수요 확인", ownerId: staff.id, status: "PENDING" },
      { tenantId: tenant.id, instructionId: instruction.id, order: 2, title: "초도 물량 확보", expectedResult: "출시일 맞춰 초도 1,000개", status: "PENDING" },
    ],
  });

  console.log("✅ Seeded demo tenant 'acme'");
  console.log("   로그인: slug=acme, email=ceo@acme.com / lead@acme.com / staff@acme.com, password=password");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
