// The "our format" of an outgoing SAY mail: the user's words plus the 직답
// button — one click, no account, and the answer lands straight in our DB.
// Pure string building; fully testable.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AskMailInput {
  senderName: string; // 김대표
  senderEmail: string; // json@icams.co.kr
  subject: string;
  body: string; // may be empty
  replyUrl: string; // https://…/r/{token}
  /** 발송 전에 분해된 꼭지 목록 — 일의 전후: 상대는 무엇에 답해야 하는지
   * 메일 안에서 본다. 답도 이 항목들에 맞춰 돌아온다. */
  tasks?: string[];
}

/** Plain-text alternative — the button becomes a bare link. */
export function askMailText(m: AskMailInput): string {
  const tasks = (m.tasks ?? []).filter(Boolean);
  return [
    m.body || m.subject,
    ...(tasks.length
      ? ["", "요청 항목:", ...tasks.map((t, i) => `  ${i + 1}. ${t}`)]
      : []),
    "",
    "―――",
    `▶ 아래 링크에서 바로 답변하실 수 있습니다 (가입 불필요):`,
    m.replyUrl,
    "",
    `링크가 열리지 않는 환경(사내 보안망 등)이라면 이 메일에 그대로 회신해 주세요 —`,
    `파일도 회신에 첨부하시면 됩니다.`,
    "",
    `${m.senderName} <${m.senderEmail}> · Saydog로 요청됨`,
  ].join("\n");
}

/** HTML alternative — real button, inline styles only (mail clients strip CSS). */
export function askMailHtml(m: AskMailInput): string {
  const bodyHtml = escapeHtml(m.body || m.subject).replace(/\n/g, "<br/>");
  const tasks = (m.tasks ?? []).filter(Boolean);
  const tasksHtml = tasks.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;"><tr><td style="padding:14px 18px;font-family:Apple SD Gothic Neo,Malgun Gothic,Segoe UI,sans-serif;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#6b7280;">요청 항목</p>
      ${tasks.map((t, i) => `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#374151;">${i + 1}. ${escapeHtml(t)}</p>`).join("")}
    </td></tr></table>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
  <tr><td style="padding:28px 32px 8px;font-family:Apple SD Gothic Neo,Malgun Gothic,Segoe UI,sans-serif;">
    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">${escapeHtml(m.senderName)} &lt;${escapeHtml(m.senderEmail)}&gt; 님의 요청</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(m.subject)}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">${bodyHtml}</p>
    ${tasksHtml}
  </td></tr>
  <tr><td align="center" style="padding:0 32px 28px;">
    <a href="${escapeHtml(m.replyUrl)}"
       style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-family:Apple SD Gothic Neo,Malgun Gothic,Segoe UI,sans-serif;font-size:15px;font-weight:600;padding:12px 32px;border-radius:8px;">
      ✍️ 바로 답변하기
    </a>
    <p style="margin:12px 0 0;font-family:Apple SD Gothic Neo,Malgun Gothic,Segoe UI,sans-serif;font-size:12px;color:#9ca3af;">
      가입·로그인 없이 답변할 수 있습니다. 링크가 열리지 않는 환경이라면 이 메일에 회신(파일 첨부 포함)하셔도 됩니다.
    </p>
  </td></tr>
</table>
<p style="margin:16px 0 0;font-family:Apple SD Gothic Neo,Malgun Gothic,Segoe UI,sans-serif;font-size:11px;color:#9ca3af;">
  Saydog — 맡긴 일이 흐르는지 지켜봅니다
</p>
</td></tr></table>
</body></html>`;
}
