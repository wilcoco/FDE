// Pluggable transactional email. Default provider: Resend (simple HTTPS API,
// no dependency). If unconfigured, emails are logged server-side only — never
// exposed to the client — so no account-takeover path exists in dev/demo.

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Returns true if the message was actually handed to a provider. */
export async function sendMail(msg: Mail): Promise<boolean> {
  const provider = (process.env.MAIL_PROVIDER || "resend").toLowerCase();

  if (!mailConfigured()) {
    // Secure fallback: log to server console only.
    console.warn(
      `[mail] not configured (set RESEND_API_KEY + MAIL_FROM). Would send to ${msg.to}: ${msg.subject}`,
    );
    return false;
  }

  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      console.error(`[mail] resend ${res.status}: ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  }

  console.error(`[mail] unknown MAIL_PROVIDER: ${provider}`);
  return false;
}

function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

/** Compose + send a password-reset email. */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<boolean> {
  const link = `${appUrl()}/reset/${token}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="font-weight:800;color:#4f46e5;font-size:20px">FlowDesk</div>
      <p style="color:#111827;font-size:15px">안녕하세요 ${name}님,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6">
        비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정하세요.
        본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.
      </p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">
          비밀번호 재설정
        </a>
      </p>
      <p style="color:#6b7280;font-size:12px">이 링크는 1시간 동안만 유효합니다.</p>
      <p style="color:#9ca3af;font-size:12px;word-break:break-all">${link}</p>
    </div>`;
  const text = `FlowDesk 비밀번호 재설정\n\n안녕하세요 ${name}님,\n아래 링크에서 새 비밀번호를 설정하세요 (1시간 유효):\n${link}\n\n본인이 요청하지 않았다면 무시하세요.`;
  return sendMail({ to, subject: "[FlowDesk] 비밀번호 재설정", html, text });
}
