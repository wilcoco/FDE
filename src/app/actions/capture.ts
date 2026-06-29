"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { generateMilestones, synthesizeStrategy } from "@/lib/ai";
import { notify } from "@/lib/notify";
import type { MilestoneStatus, Prisma } from "@prisma/client";

/** Capture an owner instruction → AI decomposes into coarse milestones (꼭지). */
export async function captureInstruction(formData: FormData) {
  const { tenant, user } = await requireContext();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) redirect("/capture?error=empty");

  const gen = await generateMilestones(rawText);

  const instruction = await prisma.$transaction(async (tx) => {
    const inst = await tx.instruction.create({
      data: {
        tenantId: tenant.id,
        authorId: user.id,
        rawText,
        summary: gen.summary,
        source: "TEXT",
      },
    });
    await tx.milestone.createMany({
      data: gen.milestones.map((m, i) => ({
        tenantId: tenant.id,
        instructionId: inst.id,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult || null,
        status: (i === 0 ? "ACTIVE" : "PENDING") as MilestoneStatus,
        activatedAt: i === 0 ? new Date() : null,
        proof: [] as Prisma.InputJsonValue,
      })),
    });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, actorId: user.id, action: "INSTRUCTION_CAPTURED", target: inst.id },
    });
    return inst;
  });

  redirect(`/instructions/${instruction.id}`);
}

async function ownMilestone(tenantId: string, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, tenantId } });
  if (!m) throw new Error("꼭지를 찾을 수 없습니다");
  return m;
}

export async function updateMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.update({
    where: { id },
    data: {
      title: String(formData.get("title") ?? m.title).trim() || m.title,
      expectedResult: String(formData.get("expectedResult") ?? "") || null,
      dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))) : null,
    },
  });
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function assignMilestoneOwner(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "") || null;
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.update({ where: { id }, data: { ownerId } });
  if (ownerId && m.status === "ACTIVE") {
    await notify(prisma, {
      tenantId: tenant.id, userId: ownerId, type: "MILESTONE_ASSIGNED",
      title: `꼭지가 배정되었습니다: ${m.title}`, link: `/instructions/${m.instructionId}`,
    });
  }
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function setMilestoneStatus(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "PENDING") as MilestoneStatus;
  const m = await ownMilestone(tenant.id, id);

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id },
      data: {
        status,
        activatedAt: status === "ACTIVE" && !m.activatedAt ? new Date() : m.activatedAt,
        doneAt: status === "DONE" ? new Date() : null,
      },
    });
    // auto-activate the next pending milestone when one completes (light sequencing)
    if (status === "DONE") {
      const next = await tx.milestone.findFirst({
        where: { tenantId: tenant.id, instructionId: m.instructionId, status: "PENDING", order: { gt: m.order } },
        orderBy: { order: "asc" },
      });
      if (next) {
        await tx.milestone.update({ where: { id: next.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
        if (next.ownerId) {
          await notify(tx, {
            tenantId: tenant.id, userId: next.ownerId, type: "MILESTONE_ASSIGNED",
            title: `다음 꼭지가 시작되었습니다: ${next.title}`, link: `/instructions/${m.instructionId}`,
          });
        }
      }
    }
  });
  revalidatePath(`/instructions/${m.instructionId}`);
  revalidatePath("/inbox");
}

export async function addMilestoneProof(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const type = String(formData.get("type") ?? "note");
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  const m = await ownMilestone(tenant.id, id);
  const proof = Array.isArray(m.proof) ? (m.proof as unknown[]) : [];
  proof.push({ type, value, by: user.name, at: new Date().toISOString() });
  await prisma.milestone.update({ where: { id }, data: { proof: proof as Prisma.InputJsonValue } });
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function addMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const instructionId = String(formData.get("instructionId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const inst = await prisma.instruction.findFirst({ where: { id: instructionId, tenantId: tenant.id } });
  if (!inst) return;
  const count = await prisma.milestone.count({ where: { instructionId } });
  await prisma.milestone.create({
    data: { tenantId: tenant.id, instructionId, order: count, title, status: "PENDING", proof: [] as Prisma.InputJsonValue },
  });
  revalidatePath(`/instructions/${instructionId}`);
}

export async function deleteMilestone(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const m = await ownMilestone(tenant.id, id);
  await prisma.milestone.delete({ where: { id } });
  revalidatePath(`/instructions/${m.instructionId}`);
}

export async function linkInstructionObjective(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const objectiveId = String(formData.get("objectiveId") ?? "") || null;
  await prisma.instruction.updateMany({ where: { id, tenantId: tenant.id }, data: { objectiveId } });
  revalidatePath(`/instructions/${id}`);
}

export async function archiveInstruction(formData: FormData) {
  const { tenant } = await requireContext();
  const id = String(formData.get("id") ?? "");
  await prisma.instruction.updateMany({ where: { id, tenantId: tenant.id }, data: { status: "ARCHIVED" } });
  revalidatePath("/instructions");
  redirect("/instructions");
}

/** Run the upward strategic-coherence synthesis over the instruction stream. */
export async function runSynthesis() {
  const { tenant, user } = await requireContext();
  const [instructions, objectives] = await Promise.all([
    prisma.instruction.findMany({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.objective.findMany({ where: { tenantId: tenant.id } }),
  ]);
  const result = await synthesizeStrategy(
    instructions.map((i) => ({ id: i.id, text: i.summary || i.rawText })),
    objectives.map((o) => ({ id: o.id, title: o.title })),
  );
  await prisma.strategySynthesis.create({
    data: { tenantId: tenant.id, createdById: user.id, result: result as unknown as Prisma.InputJsonValue },
  });
  revalidatePath("/strategy");
}
