import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/** Create an in-app notification (the "alarm" that surfaces tasks/approvals). */
export async function notify(
  db: Db,
  entry: {
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    body?: string;
    link?: string;
  },
) {
  return db.notification.create({ data: entry });
}
