"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/lib/session";
import { atLeast } from "@/lib/rbac";
import { parseColumns, coerceRow, rowHasContent, type Column } from "@/lib/datatable";
import type { Prisma } from "@prisma/client";

/** Define a structured table on a milestone (columns fixed at creation). */
export async function createDataTable(formData: FormData) {
  const { tenant, user } = await requireContext();
  const milestoneId = String(formData.get("milestoneId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, tenantId: tenant.id },
    select: { id: true, instructionId: true },
  });
  if (!milestone) return;

  const columns = parseColumns(
    formData.getAll("label").map(String),
    formData.getAll("type").map(String),
  );
  if (columns.length === 0) return;

  await prisma.dataTable.create({
    data: {
      tenantId: tenant.id,
      milestoneId,
      name,
      columns: columns as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });
  revalidatePath(`/instructions/${milestone.instructionId}`);
}

/** Append a row to a table, coerced against its column types. */
export async function addDataRow(formData: FormData) {
  const { tenant, user } = await requireContext();
  const tableId = String(formData.get("tableId") ?? "");
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, tenantId: tenant.id },
    select: { id: true, columns: true, milestone: { select: { instructionId: true } } },
  });
  if (!table) return;

  const columns = (Array.isArray(table.columns) ? table.columns : []) as unknown as Column[];
  const raw: Record<string, string> = {};
  for (const col of columns) raw[col.key] = String(formData.get(col.key) ?? "");
  const values = coerceRow(columns, raw);
  if (!rowHasContent(values)) return; // don't store empty rows

  await prisma.dataRow.create({
    data: {
      tenantId: tenant.id,
      tableId,
      values: values as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });
  revalidatePath(`/instructions/${table.milestone.instructionId}`);
}

/** Delete a row (author or admin). */
export async function deleteDataRow(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const row = await prisma.dataRow.findFirst({
    where: { id, tenantId: tenant.id },
    select: { createdById: true, table: { select: { milestone: { select: { instructionId: true } } } } },
  });
  if (!row) return;
  if (row.createdById !== user.id && !atLeast(user.role, "ADMIN")) return;
  await prisma.dataRow.delete({ where: { id } });
  revalidatePath(`/instructions/${row.table.milestone.instructionId}`);
}

/** Delete a whole table + its rows (creator or admin). */
export async function deleteDataTable(formData: FormData) {
  const { tenant, user } = await requireContext();
  const id = String(formData.get("id") ?? "");
  const table = await prisma.dataTable.findFirst({
    where: { id, tenantId: tenant.id },
    select: { createdById: true, milestone: { select: { instructionId: true } } },
  });
  if (!table) return;
  if (table.createdById !== user.id && !atLeast(user.role, "ADMIN")) return;
  await prisma.dataTable.delete({ where: { id } });
  revalidatePath(`/instructions/${table.milestone.instructionId}`);
}
