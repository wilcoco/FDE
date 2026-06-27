import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startInstanceAction } from "@/app/actions/instance";

interface Field { key: string; label: string; type: string }

export default async function StartProcess({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireContext();
  const def = await prisma.processDefinition.findFirst({
    where: { id, tenantId: tenant.id },
    include: { nodes: { where: { type: "TASK" } } },
  });
  if (!def) notFound();
  if (def.status !== "ACTIVE") redirect(`/processes/${id}`);

  const members = await prisma.user.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  const fields = (def.formSchema as unknown as Field[]) ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href={`/processes/${id}`} className="text-sm text-gray-400 hover:underline">← {def.name}</Link>
        <h1 className="mt-1 text-2xl font-bold">프로세스 실행 (기안)</h1>
        <p className="text-sm text-gray-500">작업 담당자를 지정하고 필요한 정보를 입력하면 프로세스가 시작됩니다.</p>
      </div>

      <form action={startInstanceAction} className="card space-y-5">
        <input type="hidden" name="definitionId" value={def.id} />
        <div>
          <label className="label">제목</label>
          <input name="title" defaultValue={def.name} className="input" required />
        </div>

        {fields.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">입력 정보</h3>
            {fields.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea name={`f_${f.key}`} className="input" />
                ) : (
                  <input
                    name={`f_${f.key}`}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    className="input"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {def.nodes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">작업 담당자 지정</h3>
            {def.nodes.map((n) => (
              <div key={n.id}>
                <label className="label">
                  {n.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {(n.config as { assignee?: { description?: string } })?.assignee?.description}
                  </span>
                </label>
                <select name={`a_${n.key}`} className="input">
                  <option value="">(나중에 지정)</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <button className="btn w-full">프로세스 시작</button>
      </form>
    </div>
  );
}
