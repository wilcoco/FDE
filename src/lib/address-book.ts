// 브라우저-로컬 주소록 — Gmail 보낸편지함에서 수확한 수신자 명단.
// 메일에서 파생된 데이터는 이 기기(localStorage)를 떠나지 않는다: send-only
// 서버 원칙·로컬 면제 논리와 정합. 병합·추천 로직은 순수 함수(테스트 가능),
// localStorage 접근만 얇은 래퍼로 분리.

import { normalizeEmail } from "./inbound-email";

export interface AddrEntry {
  email: string;
  count: number;
  lastSeen: number; // epoch ms
}

const MAX_BOOK = 200;

/** 보낸 메일에서 본 주소들을 주소록에 병합 (자기 자신·비정상 주소 제외). */
export function mergeAddresses(book: AddrEntry[], seen: string[], now: number, self = ""): AddrEntry[] {
  const me = normalizeEmail(self);
  const map = new Map(book.map((e) => [e.email, { ...e }]));
  for (const raw of seen) {
    const email = normalizeEmail(raw);
    if (!email || !email.includes("@") || email === me) continue;
    const cur = map.get(email);
    if (cur) {
      cur.count += 1;
      cur.lastSeen = now;
    } else {
      map.set(email, { email, count: 1, lastSeen: now });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, MAX_BOOK);
}

/** 칩 추천 목록: 로컬 주소록(빈도·최근순) + DB 원장을 중복 없이 합쳐 상위 n. */
export function topAddresses(book: AddrEntry[], ledger: string[], n = 8, self = ""): string[] {
  const me = normalizeEmail(self);
  const out: string[] = [];
  const push = (e: string) => {
    const email = normalizeEmail(e);
    if (email && email.includes("@") && email !== me && !out.includes(email)) out.push(email);
  };
  for (const e of [...book].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)) push(e.email);
  for (const e of ledger) push(e);
  return out.slice(0, n);
}

/**
 * 지시문 안에서 후보 주소를 찾는다 — 전체 주소 또는 로컬파트(3자 이상)가
 * 텍스트에 등장하면 추천. ("json한테 견적 요청" → json@icams.co.kr)
 */
export function suggestFromText(rawText: string, candidates: string[]): string[] {
  const t = rawText.toLowerCase();
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const c of candidates) {
    const email = normalizeEmail(c);
    const local = email.split("@")[0];
    if (email && (t.includes(email) || (local.length >= 3 && t.includes(local)))) out.push(email);
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
