"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createTenantWithOwner } from "@/lib/provisioning";
import { verifyPending } from "@/lib/social";
import { startSession } from "@/lib/session";

export interface FormState {
  error?: string;
}

/**
 * Finish a first-time social signup: the verified profile is carried in the
 * signed `fd_pending` cookie; the user only supplies a company name. Creates
 * the tenant (binding the org id so colleagues auto-join later) + OWNER user.
 */
export async function completeSocialSignup(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const store = await cookies();
  const token = store.get("fd_pending")?.value;
  const pending = token ? await verifyPending(token) : null;
  if (!pending) return { error: "가입 세션이 만료되었습니다. 다시 로그인해 주세요." };

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) return { error: "회사명을 입력하세요." };

  const email = pending.email || `${pending.provider}_${pending.sub}@no-email.local`;
  const { tenant, user } = await createTenantWithOwner(
    companyName,
    {
      email,
      name: pending.name,
      authProvider: pending.provider,
      authSub: pending.sub,
    },
    {
      // Bind the org identifier so future colleagues from the same
      // Workspace/Slack team join THIS company automatically.
      googleDomain: pending.provider === "google" ? pending.orgId ?? null : null,
      slackTeamId: pending.provider === "slack" ? pending.orgId ?? null : null,
    },
  );

  store.delete("fd_pending");
  await startSession({ userId: user.id, tenantId: tenant.id, role: user.role });
  redirect("/dashboard");
}
