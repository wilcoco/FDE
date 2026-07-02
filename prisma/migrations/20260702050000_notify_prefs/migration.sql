-- AlterTable: per-user notification channel preferences
ALTER TABLE "User" ADD COLUMN     "notifyPrefs" JSONB NOT NULL DEFAULT '{}';
