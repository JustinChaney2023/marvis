-- CreateTable
CREATE TABLE "GoogleCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleAccountId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleCalendar_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill: each existing GoogleAccount had exactly one implicit calendar
-- (its old calendarId column) — carry it over as that account's first,
-- default GoogleCalendar row before the old column is dropped below.
INSERT INTO "GoogleCalendar" ("id", "googleAccountId", "calendarId", "summary", "isDefault", "lastSyncedAt", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "id", "calendarId", "calendarId", true, "lastSyncedAt", "createdAt", "updatedAt"
FROM "GoogleAccount";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "meetingUrl" TEXT,
    "location" TEXT,
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
    "googleCalendarId" TEXT,
    "googleEventId" TEXT,
    "googleUpdatedAt" DATETIME,
    "localDirty" BOOLEAN NOT NULL DEFAULT false,
    "appleEventUid" TEXT,
    "subscriptionId" TEXT,
    "subscriptionEventUid" TEXT,
    "bookingLinkId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "excludeDates" TEXT,
    "recurrenceEndsBefore" DATETIME,
    "recurrenceExceptionOfId" TEXT,
    "recurrenceOriginalStart" DATETIME,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_googleCalendarId_fkey" FOREIGN KEY ("googleCalendarId") REFERENCES "GoogleCalendar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CalendarSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES "BookingLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_recurrenceExceptionOfId_fkey" FOREIGN KEY ("recurrenceExceptionOfId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("id", "userId", "title", "meetingUrl", "location", "start", "end", "allDay", "notes", "color", "recurrenceRule", "locked", "eventType", "reminderMinutes", "taskId", "habitId", "source", "googleCalendarId", "googleEventId", "googleUpdatedAt", "localDirty", "appleEventUid", "subscriptionId", "subscriptionEventUid", "bookingLinkId", "createdAt", "updatedAt", "excludeDates", "recurrenceEndsBefore", "recurrenceExceptionOfId", "recurrenceOriginalStart")
SELECT "id", "userId", "title", "meetingUrl", "location", "start", "end", "allDay", "notes", "color", "recurrenceRule", "locked", "eventType", "reminderMinutes", "taskId", "habitId", "source",
  (SELECT "gc"."id" FROM "GoogleCalendar" "gc" WHERE "gc"."googleAccountId" = "Event"."googleAccountId"),
  "googleEventId", "googleUpdatedAt", "localDirty", "appleEventUid", "subscriptionId", "subscriptionEventUid", "bookingLinkId", "createdAt", "updatedAt", "excludeDates", "recurrenceEndsBefore", "recurrenceExceptionOfId", "recurrenceOriginalStart"
FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_appleEventUid_key" ON "Event"("appleEventUid");
CREATE INDEX "Event_userId_start_idx" ON "Event"("userId", "start");
CREATE UNIQUE INDEX "Event_subscriptionId_subscriptionEventUid_key" ON "Event"("subscriptionId", "subscriptionEventUid");
CREATE UNIQUE INDEX "Event_googleCalendarId_googleEventId_key" ON "Event"("googleCalendarId", "googleEventId");
CREATE TABLE "new_GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GoogleAccount" ("id", "userId", "email", "label", "isDefault", "accessToken", "refreshToken", "expiresAt", "createdAt", "updatedAt")
SELECT "id", "userId", "email", "label", "isDefault", "accessToken", "refreshToken", "expiresAt", "createdAt", "updatedAt" FROM "GoogleAccount";
DROP TABLE "GoogleAccount";
ALTER TABLE "new_GoogleAccount" RENAME TO "GoogleAccount";
CREATE UNIQUE INDEX "GoogleAccount_userId_email_key" ON "GoogleAccount"("userId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendar_googleAccountId_calendarId_key" ON "GoogleCalendar"("googleAccountId", "calendarId");
