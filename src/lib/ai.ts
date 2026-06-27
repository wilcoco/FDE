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
