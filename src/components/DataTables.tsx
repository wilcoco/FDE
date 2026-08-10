import { createDataTable, addDataRow, deleteDataRow, deleteDataTable } from "@/app/actions/datatable";
import { formatCell, type Column, type CellValue } from "@/lib/datatable";

export interface DataTableView {
  id: string;
  name: string;
  columns: Column[];
  rows: { id: string; values: Record<string, CellValue>; by: string; canDelete: boolean }[];
}

/** Structured "do" data for one milestone: existing tables + a define-new form. */
export default function DataTables({
  milestoneId,
  tables,
}: {
  milestoneId: string;
  tables: DataTableView[];
}) {
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">📊 데이터 기록 (표)</div>

      {tables.map((t) => (
        <div key={t.id} className="mt-2 rounded-md border border-slate-200 bg-white p-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t.name}</span>
            <form action={deleteDataTable}>
              <input type="hidden" name="id" value={t.id} />
              <button className="text-[11px] text-gray-300 hover:text-red-500">표 삭제</button>
            </form>
          </div>

          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  {t.columns.map((c) => (
                    <th key={c.key} className="py-1 pr-3 font-medium">
                      {c.label}
                      <span className="ml-1 text-[10px] text-slate-300">
                        {c.type === "number" ? "#" : c.type === "date" ? "📅" : ""}
                      </span>
                    </th>
                  ))}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {t.rows.length === 0 && (
                  <tr><td colSpan={t.columns.length + 1} className="py-1 text-xs text-gray-400">아직 행이 없습니다.</td></tr>
                )}
                {t.rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    {t.columns.map((c) => (
                      <td key={c.key} className={`py-1 pr-3 ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                        {formatCell(c, r.values)}
                      </td>
                    ))}
                    <td className="py-1 text-right">
                      {r.canDelete && (
                        <form action={deleteDataRow}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-[11px] text-gray-300 hover:text-red-500" title={`${r.by} 입력`}>×</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* add-row form */}
          <form action={addDataRow} className="mt-2 flex flex-wrap items-end gap-1">
            <input type="hidden" name="tableId" value={t.id} />
            {t.columns.map((c) => (
              <input
                key={c.key}
                name={c.key}
                type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                step={c.type === "number" ? "any" : undefined}
                placeholder={c.label}
                className="input w-28 py-1 text-xs"
              />
            ))}
            <button className="btn-ghost text-xs">＋ 행 추가</button>
          </form>
        </div>
      ))}

      {/* define a new table — up to 4 columns via the quick form */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">＋ 새 표 만들기</summary>
        <form action={createDataTable} className="mt-2 space-y-1">
          <input type="hidden" name="milestoneId" value={milestoneId} />
          <input name="name" placeholder="표 이름 (예: 거래처 발송 내역)" className="input py-1 text-xs" required />
          <p className="text-[11px] text-gray-400">열을 정의하세요 (빈 칸은 무시). 만든 뒤에는 행만 추가합니다.</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-1">
              <input name="label" placeholder={`열 ${i + 1} 이름`} className="input flex-1 py-1 text-xs" />
              <select name="type" className="input w-24 py-1 text-xs" defaultValue="text">
                <option value="text">텍스트</option>
                <option value="number">숫자</option>
                <option value="date">날짜</option>
              </select>
            </div>
          ))}
          <button className="btn-ghost text-xs">표 생성</button>
        </form>
      </details>
    </div>
  );
}
