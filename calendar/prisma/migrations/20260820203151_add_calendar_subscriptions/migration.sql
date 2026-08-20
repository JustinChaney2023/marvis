-- CreateTable
CREATE TABLE "CalendarSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "lastFetchedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "taskId" TEXT,
    "habitId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LOCAL',
    "googleEventId" TEXT,
    "googleUpdatedAt" DATETIME,
    "localDirty" BOOLEAN NOT NULL DEFAULT false,
    "appleEventUid" TEXT,
    "subscriptionId" TEXT,
    "subscriptionEventUid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CalendarSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("allDay", "appleEventUid", "color", "createdAt", "end", "googleEventId", "googleUpdatedAt", "habitId", "id", "localDirty", "locked", "meetingUrl", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt", "userId") SELECT "allDay", "appleEventUid", "color", "createdAt", "end", "googleEventId", "googleUpdatedAt", "habitId", "id", "localDirty", "locked", "meetingUrl", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt", "userId" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_googleEventId_key" ON "Event"("googleEventId");
CREATE UNIQUE INDEX "Event_appleEventUid_key" ON "Event"("appleEventUid");
CREATE INDEX "Event_userId_start_idx" ON "Event"("userId", "start");
CREATE UNIQUE INDEX "Event_subscriptionId_subscriptionEventUid_key" ON "Event"("subscriptionId", "subscriptionEventUid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
