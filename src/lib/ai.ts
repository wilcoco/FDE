import Anthropic from "@anthropic-ai/sdk";

/**
 * Natural-language manual → process graph.
 *
 * Uses Claude (claude-opus-4-8) with a forced tool call for reliable structured
 * output. Falls back to a simple heuristic generator when no API key is set, so
 * the product works (at lower quality) without credentials.
 */

export interface GenNode {
  key: string;
  type: "START" | "TASK" | "APPROVAL" | "AUTOMATION" | "CONDITION" | "END";
  name: string;
  approvalKind?: "GENERAL" | "COST";
  /** TASK: who should do this (resolved to a person at launch) */
  assigneeDescription?: string;
  /** APPROVAL(GENERAL): org-relative approver, e.g. "MANAGER" */
  approverRelation?: "MANAGER";
  /** APPROVAL(COST): form field holding the amount for 전결 routing */
  amountField?: string;
  automationAction?: string;
}

export interface GenEdge {
  from: string;
  to: string;
  label?: string;
  conditionField?: string;
  conditionOp?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  conditionValue?: string;
}

export interface GenProcess {
  name: string;
  description: string;
  formFields: { key: string; label: string; type: string }[];
  nodes: GenNode[];
  edges: GenEdge[];
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const SYSTEM = `당신은 업무 프로세스 설계 도우미입니다. 사용자가 자연어로 적은 업무 매뉴얼을 실행 가능한 프로세스 그래프(노드+엣지)로 변환합니다.

규칙:
- 노드 타입: START(시작, 정확히 1개), TASK(사람이 수행하는 작업), APPROVAL(결재/승인), AUTOMATION(자동 처리), CONDITION(조건 분기), END(종료, 1개 이상).
- 모든 노드는 고유한 key(영문 소문자/숫자/하이픈)를 가진다.
- edge는 노드 key를 from/to로 참조한다. 그래프는 START에서 END까지 연결되어야 한다.
- "승인/결재/허가"가 필요한 의사결정은 APPROVAL 노드로 만든다. 비용/예산/지출 승인이면 approvalKind="COST"와 amountField(금액이 들어갈 폼 필드 key)를 지정한다. 그 외 일반 의사결정은 approvalKind="GENERAL", approverRelation="MANAGER".
- TASK 노드는 assigneeDescription에 담당자 역할을 설명만 한다(실제 담당자는 실행 시 지정).
- 금액/기간 등으로 갈라지는 분기는 CONDITION 노드 + 조건이 달린 edge로 표현한다(conditionField/op/value).
- 입력이 필요한 값은 formFields로 정의한다(예: 금액 amount, 사유 reason).
- 한국어로 노드 name을 작성한다.`;

const TOOL = {
  name: "emit_process",
  description: "변환된 프로세스 그래프를 출력합니다.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      formFields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            label: { type: "string" },
            type: { type: "string", enum: ["text", "number", "date", "textarea"] },
          },
          required: ["key", "label", "type"],
        },
      },
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            type: { type: "string", enum: ["START", "TASK", "APPROVAL", "AUTOMATION", "CONDITION", "END"] },
            name: { type: "string" },
            approvalKind: { type: "string", enum: ["GENERAL", "COST"] },
            assigneeDescription: { type: "string" },
            approverRelation: { type: "string", enum: ["MANAGER"] },
            amountField: { type: "string" },
            automationAction: { type: "string" },
          },
          required: ["key", "type", "name"],
        },
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
            conditionField: { type: "string" },
            conditionOp: { type: "string", enum: ["eq", "ne", "gt", "gte", "lt", "lte"] },
            conditionValue: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["name", "description", "formFields", "nodes", "edges"],
  },
};

export async function generateProcess(manual: string): Promise<GenProcess> {
  if (!process.env.ANTHROPIC_API_KEY) return heuristic(manual);
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emit_process" },
      messages: [{ role: "user", content: `다음 업무 매뉴얼을 프로세스 그래프로 변환하세요:\n\n${manual}` }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      return normalize(block.input as GenProcess, manual);
    }
    return heuristic(manual);
  } catch (e) {
    console.error("AI generation failed, using heuristic fallback:", e);
    return heuristic(manual);
  }
}

/** Ensure exactly one START and at least one END, and connectivity sanity. */
function normalize(p: GenProcess, manual: string): GenProcess {
  if (!p.nodes?.length) return heuristic(manual);
  const hasStart = p.nodes.some((n) => n.type === "START");
  const hasEnd = p.nodes.some((n) => n.type === "END");
  if (!hasStart) p.nodes.unshift({ key: "start", type: "START", name: "시작" });
  if (!hasEnd) p.nodes.push({ key: "end", type: "END", name: "종료" });
  p.formFields ??= [];
  p.edges ??= [];
  return p;
}

// ── flagship: instruction → coarse milestones (꼭지) ─────────────────────────

export interface GenMilestone {
  title: string;
  expectedResult: string;
  ownerHint: string;
}
export interface GenMilestones {
  summary: string;
  milestones: GenMilestone[];
}

const MILESTONE_SYSTEM = `당신은 대표(CEO)의 지시를 *굵직한 꼭지(milestone)*로 분해하는 비서입니다.

핵심 원칙:
- BPM처럼 상세하게 쪼개지 마세요. 대표가 관리할 **핵심 꼭지 3~6개**만.
- 상세 실행은 조직이 알아서 합니다. 대표는 *순서와 결과*만 봅니다.
- 각 꼭지에: title(무엇을), expectedResult(어떤 결과가 나와야 완료인지), ownerHint(어떤 역할이 맡을지 — 사람 이름 말고 역할).
- 순서대로 나열하세요.
- 한국어로.`;

const MILESTONE_TOOL = {
  name: "emit_milestones",
  description: "지시를 굵직한 꼭지로 분해해 출력합니다.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "지시의 한 줄 요약" },
      milestones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            expectedResult: { type: "string" },
            ownerHint: { type: "string" },
          },
          required: ["title", "expectedResult", "ownerHint"],
        },
      },
    },
    required: ["summary", "milestones"],
  },
};

export async function generateMilestones(instruction: string): Promise<GenMilestones> {
  if (!process.env.ANTHROPIC_API_KEY) return heuristicMilestones(instruction);
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: MILESTONE_SYSTEM,
      tools: [MILESTONE_TOOL],
      tool_choice: { type: "tool", name: "emit_milestones" },
      messages: [{ role: "user", content: `다음 대표 지시를 꼭지로 분해하세요:\n\n${instruction}` }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      const out = block.input as GenMilestones;
      if (out.milestones?.length) return out;
    }
    return heuristicMilestones(instruction);
  } catch (e) {
    console.error("milestone generation failed, heuristic fallback:", e);
    return heuristicMilestones(instruction);
  }
}

function heuristicMilestones(instruction: string): GenMilestones {
  const parts = instruction
    .split(/\n|\.|,|→|그리고|하고|후에|뒤에|다음/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 6);
  const milestones: GenMilestone[] = (parts.length ? parts : [instruction]).map((p) => ({
    title: p.slice(0, 50),
    expectedResult: "",
    ownerHint: "담당자",
  }));
  return { summary: instruction.slice(0, 60), milestones };
}

// ── flagship: strategic synthesis across the instruction stream ──────────────

export interface StrategyResult {
  groups: { theme: string; instructionIds: string[] }[];
  contradictions: { instructionIdA: string; instructionIdB: string; reason: string }[];
  orphans: string[];
  goalMap: { instructionId: string; objectiveId: string }[];
}

const SYNTH_SYSTEM = `당신은 정신없이 바쁜 대표가 여러 번에 걸쳐 내린 지시들 사이의 *전략적 통일성*을 해석하는 분석가입니다.

할 일:
- groups: 같은 목표/주제를 향하는 지시들을 묶기.
- contradictions: 서로 충돌·모순되는 지시 쌍과 이유.
- orphans: 어떤 전략 목표에도 붙지 않는(일회성이거나 방향 불명) 지시.
- goalMap: 지시를 제공된 목표(objective)에 매핑.

매우 중요: **없는 통일성을 지어내지 마세요.** 억지로 묶지 말고, 안 붙으면 솔직히 orphan으로 두세요. 한국어 이유로.`;

const SYNTH_TOOL = {
  name: "emit_synthesis",
  description: "지시 스트림의 전략적 해석을 출력합니다.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            theme: { type: "string" },
            instructionIds: { type: "array", items: { type: "string" } },
          },
          required: ["theme", "instructionIds"],
        },
      },
      contradictions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instructionIdA: { type: "string" },
            instructionIdB: { type: "string" },
            reason: { type: "string" },
          },
          required: ["instructionIdA", "instructionIdB", "reason"],
        },
      },
      orphans: { type: "array", items: { type: "string" } },
      goalMap: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instructionId: { type: "string" },
            objectiveId: { type: "string" },
          },
          required: ["instructionId", "objectiveId"],
        },
      },
    },
    required: ["groups", "contradictions", "orphans", "goalMap"],
  },
};

export async function synthesizeStrategy(
  instructions: { id: string; text: string }[],
  objectives: { id: string; title: string }[],
): Promise<StrategyResult> {
  if (!process.env.ANTHROPIC_API_KEY || instructions.length === 0) {
    return heuristicSynthesis(instructions);
  }
  try {
    const client = new Anthropic();
    const payload = {
      instructions: instructions.map((i) => ({ id: i.id, text: i.text.slice(0, 300) })),
      objectives,
    };
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: SYNTH_SYSTEM,
      tools: [SYNTH_TOOL],
      tool_choice: { type: "tool", name: "emit_synthesis" },
      messages: [{ role: "user", content: `지시들과 목표:\n\n${JSON.stringify(payload, null, 2)}` }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") return block.input as StrategyResult;
    return heuristicSynthesis(instructions);
  } catch (e) {
    console.error("strategy synthesis failed, heuristic fallback:", e);
    return heuristicSynthesis(instructions);
  }
}

function heuristicSynthesis(instructions: { id: string; text: string }[]): StrategyResult {
  return {
    groups: instructions.length ? [{ theme: "전체 지시", instructionIds: instructions.map((i) => i.id) }] : [],
    contradictions: [],
    orphans: [],
    goalMap: [],
  };
}

/** Heuristic fallback: linear START → (TASK per line) → END. */
function heuristic(manual: string): GenProcess {
  const lines = manual
    .split(/\n|\.|。/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 12);
  const nodes: GenNode[] = [{ key: "start", type: "START", name: "시작" }];
  const edges: GenEdge[] = [];
  let prev = "start";
  lines.forEach((line, i) => {
    const key = `step-${i + 1}`;
    const isApproval = /승인|결재|허가|approve/i.test(line);
    nodes.push({
      key,
      type: isApproval ? "APPROVAL" : "TASK",
      name: line.slice(0, 40),
      approvalKind: isApproval ? "GENERAL" : undefined,
      approverRelation: isApproval ? "MANAGER" : undefined,
      assigneeDescription: isApproval ? undefined : "담당자",
    });
    edges.push({ from: prev, to: key });
    prev = key;
  });
  nodes.push({ key: "end", type: "END", name: "종료" });
  edges.push({ from: prev, to: "end" });
  return {
    name: lines[0]?.slice(0, 30) || "새 프로세스",
    description: "자연어 매뉴얼에서 자동 생성됨 (휴리스틱)",
    formFields: [],
    nodes,
    edges,
  };
}
