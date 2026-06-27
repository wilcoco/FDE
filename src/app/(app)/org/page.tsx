import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  addDepartment, setDepartmentHead, addPosition, updateUserOrg,
  addAuthorityRule, deleteAuthorityRule, setDirectiveRestriction,
} from "@/app/actions/org";

export default async function OrgPage() {
  const { tenant, user } = await requireContext();
  const admin = can.manageOrg(user.role);

  const [departments, positions, members, rules] = await Promise.all([
    prisma.department.findMany({ where: { tenantId: tenant.id }, include: { head: true, parent: true } }),
    prisma.position.findMany({ where: { tenantId: tenant.id }, orderBy: { rank: "asc" } }),
    prisma.user.findMany({ where: { tenantId: tenant.id }, include: { department: true, position: true, manager: true }, orderBy: { name: "asc" } }),
    prisma.approvalAuthorityRule.findMany({ where: { tenantId: tenant.id }, orderBy: { approverRank: "asc" } }),
  ]);
  const tenantFull = await prisma.tenant.findUnique({ where: { id: tenant.id } });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">조직도</h1>
      {!admin && <p className="text-sm text-gray-400">조직 설정은 관리자만 변경할 수 있습니다.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* departments */}
        <div className="card">
          <h2 className="mb-3 font-semibold">부서</h2>
          <ul className="space-y-2">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>{d.parent ? `${d.parent.name} > ` : ""}{d.name} <span className="text-gray-400">({d.head?.name ?? "팀장 미지정"})</span></span>
                {admin && (
                  <form action={setDepartmentHead} className="flex gap-1">
                    <input type="hidden" name="departmentId" value={d.id} />
                    <select name="headId" defaultValue={d.headId ?? ""} className="input py-1 text-xs">
                      <option value="">팀장 지정</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button className="btn-ghost text-xs">저장</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {admin && (
            <form action={addDepartment} className="mt-3 flex gap-2">
              <input name="name" placeholder="부서명" className="input" />
              <select name="parentId" className="input">
                <option value="">상위 없음</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="btn-ghost text-sm">추가</button>
            </form>
          )}
        </div>

        {/* positions */}
        <div className="card">
          <h2 className="mb-3 font-semibold">직급 (rank 높을수록 상위)</h2>
          <ul className="space-y-1 text-sm">
            {positions.map((p) => <li key={p.id}>{p.name} <span className="text-gray-400">(rank {p.rank})</span></li>)}
          </ul>
          {admin && (
            <form action={addPosition} className="mt-3 flex gap-2">
              <input name="name" placeholder="직급명" className="input" />
              <input name="rank" type="number" placeholder="rank" className="input w-24" />
              <button className="btn-ghost text-sm">추가</button>
            </form>
          )}
        </div>
      </div>

      {/* 전결규정 */}
      <div className="card">
        <h2 className="mb-3 font-semibold">전결규정 (비용 결재선)</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">금액 상한</th><th className="th">필요 직급 rank</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.maxAmount == null ? "무제한" : `${r.maxAmount.toLocaleString()}원 이하`}</td>
                <td className="td">rank {r.approverRank} 이상</td>
                <td className="td text-right">
                  {admin && (
                    <form action={deleteAuthorityRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <form action={addAuthorityRule} className="mt-3 flex gap-2">
            <input name="maxAmount" placeholder="금액 상한(비우면 무제한)" className="input" />
            <input name="approverRank" type="number" placeholder="필요 rank" className="input w-32" />
            <button className="btn-ghost text-sm">규칙 추가</button>
          </form>
        )}
      </div>

      {/* member org assignment */}
      <div className="card">
        <h2 className="mb-3 font-semibold">멤버 조직 배치 (보고선)</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">이름</th><th className="th">부서</th><th className="th">직급</th><th className="th">상사</th>{admin && <th className="th"></th>}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((m) => (
              <tr key={m.id}>
                {admin ? (
                  <td className="td" colSpan={5}>
                    <form action={updateUserOrg} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={m.id} />
                      <span className="w-24 font-medium">{m.name}</span>
                      <select name="departmentId" defaultValue={m.departmentId ?? ""} className="input py-1 text-xs">
                        <option value="">부서</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <select name="positionId" defaultValue={m.positionId ?? ""} className="input py-1 text-xs">
                        <option value="">직급</option>
                        {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select name="managerId" defaultValue={m.managerId ?? ""} className="input py-1 text-xs">
                        <option value="">상사</option>
                        {members.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <button className="btn-ghost text-xs">저장</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="td">{m.name}</td>
                    <td className="td">{m.department?.name ?? "—"}</td>
                    <td className="td">{m.position?.name ?? "—"}</td>
                    <td className="td">{m.manager?.name ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* directive restriction (OWNER) */}
      {can.manageTenant(user.role) && (
        <div className="card">
          <h2 className="mb-2 font-semibold">업무 지시 정책</h2>
          <form action={setDirectiveRestriction} className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="restricted" defaultChecked={tenantFull?.directiveRestrictedToSuperior} />
              조직도상 상급자만 업무 지시 가능 (체크 해제 시 누구나 가능)
            </label>
            <button className="btn-ghost text-sm">저장</button>
          </form>
        </div>
      )}
    </div>
  );
}
