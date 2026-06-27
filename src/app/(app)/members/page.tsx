import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { addMember, setMemberStatus, setMemberRole } from "@/app/actions/members";
import { createInvitation, revokeInvitation } from "@/app/actions/invitations";

export default async function MembersPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageMembers(user.role);
  const owner = can.manageTenant(user.role);
  const [members, invitations] = await Promise.all([
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
  ]);
  const baseUrl = process.env.APP_URL ?? "";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">멤버</h1>

      {admin && (
        <div className="card space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">초대 링크 생성</h2>
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

      <div className="card overflow-hidden p-0">
        <table className="w-full">
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
