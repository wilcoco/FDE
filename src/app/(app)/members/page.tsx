import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { addMember, setMemberStatus, setMemberRole } from "@/app/actions/members";

export default async function MembersPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageMembers(user.role);
  const owner = can.manageTenant(user.role);
  const members = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    include: { department: true, position: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">멤버</h1>

      {admin && (
        <form action={addMember} className="card grid gap-2 md:grid-cols-5">
          <input name="name" placeholder="이름" className="input" required />
          <input name="email" type="email" placeholder="이메일" className="input" required />
          <input name="password" type="password" placeholder="초기 비밀번호(6자+)" className="input" required />
          <select name="role" className="input">
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
            {owner && <option value="OWNER">OWNER</option>}
          </select>
          <button className="btn">멤버 추가</button>
        </form>
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
