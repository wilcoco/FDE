import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { addMember, setMemberStatus, setMemberRole, setJoinLink, disableJoinLink } from "@/app/actions/members";
import { createInvitation, revokeInvitation } from "@/app/actions/invitations";
import { approveJoinRequest, rejectJoinRequest } from "@/app/actions/join-requests";

export default async function MembersPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageMembers(user.role);
  const owner = can.manageTenant(user.role);
  const [members, invitations, joinRequests] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      include: { department: true, position: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { tenantId: tenant.id, acceptedAt: null },
      include: { invitedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.joinRequest.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const pendingRequests = joinRequests.filter((r) => r.status === "PENDING");
  const processedRequests = joinRequests.filter((r) => r.status !== "PENDING").slice(0, 8);
  const baseUrl = process.env.APP_URL ?? "";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">멤버</h1>

      {admin && pendingRequests.length > 0 && (
        <div className="card space-y-3 border-indigo-200 bg-indigo-50/40">
          <h2 className="text-sm font-semibold text-indigo-800">
            가입 요청 대기 ({pendingRequests.length})
          </h2>
          <p className="text-xs text-gray-500">
            아래 사람들이 이 회사에 가입을 요청했습니다. 승인하면 바로 구성원이 됩니다.
          </p>
          <div className="space-y-2">
            {pendingRequests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-100 bg-white p-2 text-sm"
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-gray-500">{r.email}</span>
                <span className="text-xs text-gray-400">{r.createdAt.toLocaleDateString()}</span>
                <div className="ml-auto flex gap-2">
                  <form action={approveJoinRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn px-3 py-1 text-xs">승인</button>
                  </form>
                  <form action={rejectJoinRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-xs text-gray-400 hover:text-red-600">거절</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {admin && processedRequests.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">최근 처리된 가입 요청</h2>
          <div className="space-y-1">
            {processedRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-gray-400">{r.email}</span>
                <span className="text-xs text-gray-400">
                  {r.decidedAt?.toLocaleDateString() ?? ""}
                </span>
                <span
                  className={`badge ml-auto ${
                    r.status === "APPROVED"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {r.status === "APPROVED" ? "승인됨" : "거절됨"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {admin && (
        <div className="card space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">회사 공용 가입 링크</h2>
            {tenant.joinCode ? (
              <div className="flex flex-wrap items-center gap-2">
                <input readOnly value={`${baseUrl}/join/${tenant.joinCode}`} className="input flex-1 bg-white font-mono text-xs" />
                <form action={setJoinLink}><button className="btn-ghost text-xs">재발급</button></form>
                <form action={disableJoinLink}><button className="text-xs text-gray-400 hover:text-red-600">끄기</button></form>
              </div>
            ) : (
              <form action={setJoinLink}><button className="btn-ghost text-sm">가입 링크 켜기</button></form>
            )}
            <p className="mt-1 text-xs text-gray-400">
              이 링크를 단톡방 등에 공유하면 누구나 MEMBER로 가입합니다. 유출 시 “재발급”으로 무효화하세요.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">개별 초대 링크</h2>
            <form action={createInvitation} className="grid gap-2 md:grid-cols-4">
              <input name="email" type="email" placeholder="초대할 이메일" className="input md:col-span-2" required />
              <select name="role" className="input">
                <option value="MEMBER">MEMBER</option>
                <option value="ADMIN">ADMIN</option>
                {owner && <option value="OWNER">OWNER</option>}
              </select>
              <button className="btn">초대 생성</button>
            </form>
            <p className="mt-1 text-xs text-gray-400">초대받은 사람은 링크에서 직접 이름·비밀번호를 설정해 가입합니다.</p>
          </div>

          {invitations.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">대기 중 초대 ({invitations.length})</h3>
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50 p-2 text-sm">
                    <span className="font-medium">{inv.email}</span>
                    <span className="badge bg-gray-100 text-gray-600">{inv.role}</span>
                    <input
                      readOnly
                      value={`${baseUrl}/invite/${inv.token}`}
                      className="input flex-1 bg-white font-mono text-xs"
                    />
                    <span className="text-xs text-gray-400">만료 {inv.expiresAt.toLocaleDateString()}</span>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="id" value={inv.id} />
                      <button className="text-xs text-gray-400 hover:text-red-600">취소</button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">또는 멤버 직접 추가 (비밀번호 지정)</summary>
            <form action={addMember} className="mt-2 grid gap-2 md:grid-cols-5">
              <input name="name" placeholder="이름" className="input" required />
              <input name="email" type="email" placeholder="이메일" className="input" required />
              <input name="password" type="password" placeholder="초기 비밀번호(6자+)" className="input" required />
              <select name="role" className="input">
                <option value="MEMBER">MEMBER</option>
                <option value="ADMIN">ADMIN</option>
                {owner && <option value="OWNER">OWNER</option>}
              </select>
              <button className="btn-ghost">직접 추가</button>
            </form>
          </details>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="th">이름</th><th className="th">이메일</th><th className="th">부서/직급</th>
              <th className="th">역할</th><th className="th">상태</th>{admin && <th className="th"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="td font-medium">{m.name}</td>
                <td className="td text-gray-500">{m.email}</td>
                <td className="td text-gray-500">{m.department?.name ?? "—"} / {m.position?.name ?? "—"}</td>
                <td className="td">
                  {owner && m.id !== user.id ? (
                    <form action={setMemberRole} className="flex gap-1">
                      <input type="hidden" name="userId" value={m.id} />
                      <select name="role" defaultValue={m.role} className="input py-1 text-xs">
                        <option value="MEMBER">MEMBER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="OWNER">OWNER</option>
                      </select>
                      <button className="btn-ghost text-xs">변경</button>
                    </form>
                  ) : (
                    <span className="badge bg-gray-100 text-gray-600">{m.role}</span>
                  )}
                </td>
                <td className="td">
                  <span className={`badge ${m.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {m.status === "ACTIVE" ? "활성" : "비활성"}
                  </span>
                </td>
                {admin && (
                  <td className="td text-right">
                    {m.id !== user.id && (
                      <form action={setMemberStatus}>
                        <input type="hidden" name="userId" value={m.id} />
                        <input type="hidden" name="status" value={m.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
                        <button className="text-xs text-gray-400 hover:text-indigo-600">
                          {m.status === "ACTIVE" ? "비활성화" : "활성화"}
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
