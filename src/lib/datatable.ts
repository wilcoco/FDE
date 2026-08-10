// Pure logic for user-defined data tables: parse column definitions and coerce
// row values against them. No IO — fully unit-testable.

export type ColumnType = "text" | "number" | "date";
export interface Column {
  key: string; // stable id (c0, c1, …) — labels can't collide or break rows
  label: string;
  type: ColumnType;
}

const TYPES: ColumnType[] = ["text", "number", "date"];
export const MAX_COLUMNS = 12;

/**
 * Build column defs from parallel label/type arrays (as submitted by the form).
 * Blank labels are dropped; keys are positional and stable; unknown types fall
 * back to text. Returns at most MAX_COLUMNS.
 */
export function parseColumns(labels: string[], types: string[]): Column[] {
  const cols: Column[] = [];
  for (let i = 0; i < labels.length && cols.length < MAX_COLUMNS; i++) {
    const label = (labels[i] ?? "").trim();
    if (!label) continue;
    const t = types[i];
    const type: ColumnType = TYPES.includes(t as ColumnType) ? (t as ColumnType) : "text";
    cols.push({ key: `c${cols.length}`, label, type });
  }
  return cols;
}

/** A coerced cell value: number stays number, everything else a (trimmed) string. */
export type CellValue = string | number;

/**
 * Coerce a raw row (keyed by column key) against the table's columns.
 * - keys not in the schema are dropped (can't inject arbitrary fields)
 * - number columns: non-numeric → dropped for that cell (kept empty, not 0)
 * - date columns: kept as an ISO yyyy-mm-dd string when parseable, else dropped
 * - text: trimmed passthrough
 * Missing cells are simply absent from the result.
 */
export function coerceRow(
  columns: Column[],
  raw: Record<string, unknown>,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const col of columns) {
    const v = raw[col.key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    if (col.type === "number") {
      const n = Number(s);
      if (Number.isFinite(n)) out[col.key] = n;
    } else if (col.type === "date") {
      // accept yyyy-mm-dd (the <input type=date> wire format); validate calendar-ish
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out[col.key] = s;
    } else {
      out[col.key] = s;
    }
  }
  return out;
}

/** True when a coerced row has at least one filled cell (don't store empty rows). */
export function rowHasContent(values: Record<string, CellValue>): boolean {
  return Object.keys(values).length > 0;
}

/** Render a cell for display (numbers get locale grouping, dates pass through). */
export function formatCell(col: Column, values: Record<string, CellValue>): string {
  const v = values[col.key];
  if (v == null || v === "") return "";
  if (col.type === "number" && typeof v === "number") return v.toLocaleString();
  return String(v);
}
