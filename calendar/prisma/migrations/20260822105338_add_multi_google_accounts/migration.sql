/*
  Warnings:

  - Added the required column `label` to the `GoogleAccount` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "meetingUrl" TEXT,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "color" TEXT,
    "recurrenceRule" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "eventType" TEXT NOT NULL DEFAULT 'DEFAULT',
    "reminderMinutes" INTEGER DEFAULT 10,
    "taskId" TEXT,
    "habitId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LOCAL',
    "googleAccountId" TEXT,
    "googleEventId" TEXT,
    "googleUpdatedAt" DATETIME,
    "localDirty" BOOLEAN NOT NULL DEFAULT false,
    "appleEventUid" TEXT,
    "subscriptionId" TEXT,
    "subscriptionEventUid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "excludeDates" TEXT,
    "recurrenceExceptionOfId" TEXT,
    "recurrenceOriginalStart" DATETIME,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CalendarSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_recurrenceExceptionOfId_fkey" FOREIGN KEY ("recurrenceExceptionOfId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("allDay", "appleEventUid", "color", "createdAt", "end", "eventType", "excludeDates", "googleEventId", "googleUpdatedAt", "habitId", "id", "localDirty", "locked", "meetingUrl", "notes", "recurrenceExceptionOfId", "recurrenceOriginalStart", "recurrenceRule", "reminderMinutes", "source", "start", "subscriptionEventUid", "subscriptionId", "taskId", "title", "updatedAt", "userId") SELECT "allDay", "appleEventUid", "color", "createdAt", "end", "eventType", "excludeDates", "googleEventId", "googleUpdatedAt", "habitId", "id", "localDirty", "locked", "meetingUrl", "notes", "recurrenceExceptionOfId", "recurrenceOriginalStart", "recurrenceRule", "reminderMinutes", "source", "start", "subscriptionEventUid", "subscriptionId", "taskId", "title", "updatedAt", "userId" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_appleEventUid_key" ON "Event"("appleEventUid");
CREATE INDEX "Event_userId_start_idx" ON "Event"("userId", "start");
CREATE UNIQUE INDEX "Event_subscriptionId_subscriptionEventUid_key" ON "Event"("subscriptionId", "subscriptionEventUid");
CREATE UNIQUE INDEX "Event_googleAccountId_googleEventId_key" ON "Event"("googleAccountId", "googleEventId");
CREATE TABLE "new_GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Every pre-existing row is (by the old @unique on userId) the only
-- GoogleAccount its user has, so it's unambiguously that user's default
-- and its own email is a fine starting label (renameable in Settings).
INSERT INTO "new_GoogleAccount" ("accessToken", "calendarId", "createdAt", "email", "expiresAt", "id", "label", "isDefault", "lastSyncedAt", "refreshToken", "updatedAt", "userId") SELECT "accessToken", "calendarId", "createdAt", "email", "expiresAt", "id", "email", true, "lastSyncedAt", "refreshToken", "updatedAt", "userId" FROM "GoogleAccount";
DROP TABLE "GoogleAccount";
ALTER TABLE "new_GoogleAccount" RENAME TO "GoogleAccount";
CREATE UNIQUE INDEX "GoogleAccount_userId_email_key" ON "GoogleAccount"("userId", "email");

-- Backfill: every already-Google-synced Event belonged to the one
-- GoogleAccount its owner had before multi-account support existed.
UPDATE "Event" SET "googleAccountId" = (SELECT "id" FROM "GoogleAccount" WHERE "GoogleAccount"."userId" = "Event"."userId" LIMIT 1) WHERE "Event"."googleEventId" IS NOT NULL;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
