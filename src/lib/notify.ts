import { prisma } from "./db";
import { sendNotificationEmail } from "./mail";
import { shouldNotify } from "./notify-prefs";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export interface NotifyEntry {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Create an in-app notification — honors the recipient's per-category
 * preferences (silently skipped when that category's in-app channel is off).
 */
export async function notify(db: Db, entry: NotifyEntry) {
  const user = await db.user.findUnique({
    where: { id: entry.userId },
    select: { notifyPrefs: true },
  });
  if (user && !shouldNotify(user.notifyPrefs, entry.type, "inapp")) return null;
  return db.notification.create({ data: entry });
}

/**
 * Email mirror of a notification — honors the recipient's email preference.
 * Call OUTSIDE transactions, fire-and-forget:  void notifyEmail(e).catch(...)
 */
export async function notifyEmail(entry: NotifyEntry): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: entry.userId, tenantId: entry.tenantId, status: "ACTIVE" },
    select: { email: true, notifyPrefs: true },
  });
  if (!user || !shouldNotify(user.notifyPrefs, entry.type, "email")) return false;
  return sendNotificationEmail(user.email, entry);
}
