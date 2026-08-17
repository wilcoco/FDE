// 브라우저-로컬 주소록 — Gmail 보낸편지함에서 수확한 수신자 명단.
// 메일에서 파생된 데이터는 이 기기(localStorage)를 떠나지 않는다: send-only
// 서버 원칙·로컬 면제 논리와 정합. 병합·추천 로직은 순수 함수(테스트 가능),
// localStorage 접근만 얇은 래퍼로 분리.

import { normalizeEmail } from "./inbound-email";

export interface AddrEntry {
  email: string;
  /** To 헤더의 표시 이름 ("김부장 <kim@x.com>") — 음성 지시("김부장한테")를 주소로 잇는 열쇠 */
  name?: string;
  count: number;
  lastSeen: number; // epoch ms
}

/** 칩·추천에 필요한 최소 형태 (DB 원장은 이름 없이 이메일만 온다) */
export interface AddrLite { email: string; name?: string }

const MAX_BOOK = 200;

/** `"김부장" <kim@x.com>` → { name: "김부장", email: "kim@x.com" }. 이름 없으면 name="". */
export function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: normalizeEmail(raw) };
}

/** 보낸 메일에서 본 주소들을 주소록에 병합 (자기 자신·비정상 주소 제외).
 * 표시 이름은 함께 저장 — 최신의 비어있지 않은 이름이 이긴다. */
export function mergeAddresses(book: AddrEntry[], seen: string[], now: number, self = ""): AddrEntry[] {
  const me = normalizeEmail(self);
  const map = new Map(book.map((e) => [e.email, { ...e }]));
  for (const raw of seen) {
    const { name, email } = parseAddress(raw);
    if (!email || !email.includes("@") || email === me) continue;
    const cur = map.get(email);
    if (cur) {
      cur.count += 1;
      cur.lastSeen = now;
      if (name) cur.name = name;
    } else {
      map.set(email, { email, ...(name ? { name } : {}), count: 1, lastSeen: now });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, MAX_BOOK);
}

/** 칩 추천 목록: 로컬 주소록(빈도·최근순) + DB 원장을 중복 없이 합쳐 상위 n. */
export function topAddresses(book: AddrEntry[], ledger: string[], n = 8, self = ""): AddrLite[] {
  const me = normalizeEmail(self);
  const out: AddrLite[] = [];
  const push = (e: AddrLite) => {
    const email = normalizeEmail(e.email);
    if (email && email.includes("@") && email !== me && !out.some((x) => x.email === email)) {
      out.push({ email, ...(e.name ? { name: e.name } : {}) });
    }
  };
  for (const e of [...book].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)) push(e);
  for (const e of ledger) push({ email: e });
  return out.slice(0, n);
}

/**
 * 지시문 안에서 후보를 찾는다 — 전체 주소, 로컬파트(3자+), 또는 **표시 이름
 * 토큰(2자+)**이 텍스트에 등장하면 추천. 음성 지시가 "김부장한테"라고만 해도
 * 보낸편지함 헤더의 "김부장 <kim@x.com>"이 다리를 놓는다.
 */
export function suggestFromText(rawText: string, candidates: AddrLite[]): string[] {
  const t = rawText.toLowerCase();
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const c of candidates) {
    const email = normalizeEmail(c.email);
    if (!email) continue;
    const local = email.split("@")[0];
    const nameTokens = (c.name ?? "").split(/\s+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    const hit =
      t.includes(email) ||
      (local.length >= 3 && t.includes(local)) ||
      nameTokens.some((tok) => t.includes(tok.toLowerCase()));
    if (hit && !out.includes(email)) out.push(email);
  }
  return out;
}

// ── browser-only thin wrappers ───────────────────────────────────────────────

const KEY = "fd-addr-book";

export function loadAddrBook(): AddrEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as AddrEntry[]).filter((e) => e && typeof e.email === "string") : [];
  } catch {
    return [];
  }
}

/** 보낸편지함을 읽은 직후 호출 — 수확은 이 브라우저 안에서 끝난다. */
export function harvestAddresses(seen: string[], self: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(mergeAddresses(loadAddrBook(), seen, Date.now(), self)));
  } catch { /* quota 등 — 주소록은 편의 기능, 실패해도 무해 */ }
}
