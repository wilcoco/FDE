// 직답 토큰의 수명 규칙 — 순수 로직 (no IO), 코어와 페이지가 공유한다.
//
// 토큰 소지가 곧 인증인 구조의 약점은 "링크가 새면 아무나 답할 수 있다"는 것.
// 증빙(evidence) 포지셔닝이 성립하려면 최소한 시간의 울타리는 필요하다:
//  - 지시가 보관(ARCHIVED)되면 즉시 닫힌다 — 끝난 일은 답을 받지 않는다.
//  - 생성 후 90일이 지나면 닫힌다 — 전달된 메일 링크가 영원히 살지 않는다.
// (1회성으로 만들지 않는 이유: 견적 보완, 추가 파일 등 정당한 재답변이 흔하다.)

export const REPLY_TOKEN_TTL_DAYS = 90;

export interface ReplyTokenSubject {
  status: string; // InstructionStatus — "ACTIVE" | "ARCHIVED"
  createdAt: Date;
}

export function replyTokenExpired(inst: ReplyTokenSubject, now = new Date()): boolean {
  if (inst.status === "ARCHIVED") return true;
  const ageMs = now.getTime() - inst.createdAt.getTime();
  return ageMs > REPLY_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
}
