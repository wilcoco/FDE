// Per-user notification preferences — pure rules, no IO.
// Every notification type maps to a user-facing category; each category has
// two channels (in-app, email) the user can toggle on /settings.

export type Channel = "inapp" | "email";

export interface ChannelPrefs {
  inapp: boolean;
  email: boolean;
}

export interface Category {
  key: string;
  label: string;
  desc: string;
  defaults: ChannelPrefs;
}

export const CATEGORIES: Category[] = [
  {
    key: "assign",
    label: "업무 배정",
    desc: "꼭지·작업이 나에게 배정되거나 내 차례가 시작될 때",
    defaults: { inapp: true, email: true },
  },
  {
    key: "review",
    label: "검수 요청",
    desc: "담당자가 완료를 제출해 내 확인이 필요할 때 (지시자)",
    defaults: { inapp: true, email: true },
  },
  {
    key: "decision",
    label: "확인·반려 결과",
    desc: "내가 제출한 업무가 확정되거나 반려됐을 때 (담당자)",
    defaults: { inapp: true, email: true },
  },
  {
    key: "nudge",
    label: "정체·기한 알림",
    desc: "기한 초과, 며칠째 무소식, 검수 방치 감지",
    defaults: { inapp: true, email: true },
  },
  {
    key: "activity",
    label: "진행 기록",
    desc: "내가 지시한 업무에 담당자가 결과·메모를 남길 때",
    defaults: { inapp: true, email: false },
  },
  {
    key: "approval",
    label: "전자결재",
    desc: "결재 요청 도착, 승인·반려 결과",
    defaults: { inapp: true, email: true },
  },
  {
    key: "member",
    label: "멤버·가입",
    desc: "가입 요청 도착, 가입 승인 (관리자)",
    defaults: { inapp: true, email: true },
  },
];

const TYPE_TO_CATEGORY: Record<string, string> = {
  MILESTONE_ASSIGNED: "assign",
  TASK_ASSIGNED: "assign",
  TASK: "assign",
  MILESTONE_REVIEW: "review",
  MILESTONE_APPROVED: "decision",
  MILESTONE_RETURNED: "decision",
  DIRECTIVE: "decision",
  MILESTONE_NUDGE: "nudge",
  PROOF_ADDED: "activity",
  APPROVAL_REQUEST: "approval",
  APPROVAL_APPROVED: "approval",
  APPROVAL_REJECTED: "approval",
  JOIN_REQUEST: "member",
  JOIN_APPROVED: "member",
};

export function categoryOf(type: string): Category | null {
  const key = TYPE_TO_CATEGORY[type];
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * Should this notification be delivered on this channel?
 * Fails OPEN: unknown types and malformed prefs fall back to delivering
 * (a lost preference must never silently swallow a notification).
 */
export function shouldNotify(prefs: unknown, type: string, channel: Channel): boolean {
  const cat = categoryOf(type);
  if (!cat) return true; // unmapped type → always deliver

  if (prefs == null || typeof prefs !== "object" || Array.isArray(prefs)) {
    return cat.defaults[channel];
  }
  const entry = (prefs as Record<string, unknown>)[cat.key];
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
    return cat.defaults[channel];
  }
  const v = (entry as Record<string, unknown>)[channel];
  return typeof v === "boolean" ? v : cat.defaults[channel];
}

/** Merge stored prefs over defaults for rendering the settings form. */
export function effectivePrefs(prefs: unknown): Record<string, ChannelPrefs> {
  const out: Record<string, ChannelPrefs> = {};
  for (const c of CATEGORIES) {
    out[c.key] = {
      inapp: shouldNotify(prefs, typeForCategory(c.key), "inapp"),
      email: shouldNotify(prefs, typeForCategory(c.key), "email"),
    };
  }
  return out;
}

/** A representative type per category (for effectivePrefs round-trip). */
function typeForCategory(key: string): string {
  for (const [t, k] of Object.entries(TYPE_TO_CATEGORY)) if (k === key) return t;
  return "__unknown__";
}
