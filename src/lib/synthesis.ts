// Strategic-coherence synthesis runner, shared by the manual "AI 재분석" button
// and the automatic trigger (every N new instructions since the last run).

import { prisma } from "./db";
import { synthesizeStrategy } from "./ai";
import type { Prisma } from "@prisma/client";

/** New instructions since the last synthesis that trigger an automatic run. */
export const AUTO_SYNTHESIS_EVERY = 3;

export async function runSynthesisForTenant(tenantId: string, userId: string): Promise<void> {
  const [instructions, objectives] = await Promise.all([
    prisma.instruction.findMany({
      where: { tenantId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.objective.findMany({ where: { tenantId } }),
  ]);
  if (instructions.length === 0) return;

  const result = await synthesizeStrategy(
    instructions.map((i) => ({ id: i.id, text: i.summary || i.rawText })),
    objectives.map((o) => ({ id: o.id, title: o.title })),
  );
  await prisma.strategySynthesis.create({
    data: { tenantId, createdById: userId, result: result as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Fire-and-forget auto synthesis: runs when AUTO_SYNTHESIS_EVERY instructions
 * have piled up since the last run (or ever, if none). Never throws.
 */
export async function maybeAutoSynthesize(tenantId: string, userId: string): Promise<void> {
  try {
    const latest = await prisma.strategySynthesis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const newSince = await prisma.instruction.count({
      where: {
        tenantId,
        status: "ACTIVE",
        ...(latest ? { createdAt: { gt: latest.createdAt } } : {}),
      },
    });
    if (newSince >= AUTO_SYNTHESIS_EVERY) {
      await runSynthesisForTenant(tenantId, userId);
    }
  } catch (e) {
    console.error("[synthesis] auto run failed", e);
  }
}
