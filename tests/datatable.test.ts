/**
 * Tests for user-defined data tables: column parsing + row coercion.
 */
import assert from "node:assert/strict";
import { parseColumns, coerceRow, rowHasContent, formatCell, MAX_COLUMNS } from "../src/lib/datatable";

export async function run(t: (name: string, fn: () => void) => void) {
  t("parseColumns: drops blank labels, assigns stable positional keys", () => {
    const cols = parseColumns(["거래처", "", "수량"], ["text", "number", "number"]);
    assert.deepEqual(cols, [
      { key: "c0", label: "거래처", type: "text" },
      { key: "c1", label: "수량", type: "number" },
    ]);
  });

  t("parseColumns: unknown type falls back to text", () => {
    const cols = parseColumns(["a"], ["bogus"]);
    assert.equal(cols[0].type, "text");
  });

  t("parseColumns: caps at MAX_COLUMNS", () => {
    const labels = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const cols = parseColumns(labels, labels.map(() => "text"));
    assert.equal(cols.length, MAX_COLUMNS);
  });

  const cols = parseColumns(["거래처", "수량", "발송일"], ["text", "number", "date"]);

  t("coerceRow: number parses, text trims, date validated", () => {
    const v = coerceRow(cols, { c0: "  OO상사 ", c1: "300", c2: "2026-03-02" });
    assert.deepEqual(v, { c0: "OO상사", c1: 300, c2: "2026-03-02" });
  });

  t("coerceRow: non-numeric number cell is dropped, not zeroed", () => {
    const v = coerceRow(cols, { c0: "A", c1: "삼백", c2: "" });
    assert.deepEqual(v, { c0: "A" });
    assert.equal("c1" in v, false); // not stored as 0
  });

  t("coerceRow: malformed date dropped", () => {
    const v = coerceRow(cols, { c2: "3/2/2026" });
    assert.deepEqual(v, {});
  });

  t("coerceRow: unknown keys can't be injected", () => {
    const v = coerceRow(cols, { c0: "ok", evil: "x", __proto__: "y" } as Record<string, unknown>);
    assert.deepEqual(Object.keys(v), ["c0"]);
  });

  t("coerceRow: empty/whitespace cells omitted", () => {
    const v = coerceRow(cols, { c0: "   ", c1: "  ", c2: "  " });
    assert.deepEqual(v, {});
  });

  t("rowHasContent: false for empty, true for any cell", () => {
    assert.equal(rowHasContent({}), false);
    assert.equal(rowHasContent({ c0: "x" }), true);
    assert.equal(rowHasContent({ c1: 0 }), true); // legit zero
  });

  t("formatCell: numbers grouped, missing → empty string", () => {
    assert.equal(formatCell(cols[1], { c1: 12345 }), "12,345");
    assert.equal(formatCell(cols[0], {}), "");
    assert.equal(formatCell(cols[2], { c2: "2026-03-02" }), "2026-03-02");
  });
}
