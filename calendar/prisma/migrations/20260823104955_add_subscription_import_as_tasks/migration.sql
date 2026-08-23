-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "importAsTasks" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarSubscription" ("createdAt", "id", "lastError", "lastFetchedAt", "name", "url", "userId") SELECT "createdAt", "id", "lastError", "lastFetchedAt", "name", "url", "userId" FROM "CalendarSubscription";
DROP TABLE "CalendarSubscription";
ALTER TABLE "new_CalendarSubscription" RENAME TO "CalendarSubscription";
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "energy" TEXT NOT NULL DEFAULT 'MEDIUM',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "chunkMin" INTEGER,
    "trackedMinutes" INTEGER NOT NULL DEFAULT 0,
    "timerStartedAt" DATETIME,
    "startAt" DATETIME,
    "dueAt" DATETIME,
    "hardDeadline" BOOLEAN NOT NULL DEFAULT true,
    "recurrenceRule" TEXT,
    "color" TEXT,
    "projectId" TEXT,
    "assigneeId" TEXT,
    "timeSlotId" TEXT,
    "parentId" TEXT,
    "sourceSubscriptionId" TEXT,
    "sourceUid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Assignee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_sourceSubscriptionId_fkey" FOREIGN KEY ("sourceSubscriptionId") REFERENCES "CalendarSubscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "chunkMin", "color", "createdAt", "dueAt", "durationMin", "energy", "hardDeadline", "id", "notes", "parentId", "priority", "projectId", "recurrenceRule", "startAt", "status", "timeSlotId", "timerStartedAt", "title", "trackedMinutes", "updatedAt", "userId") SELECT "assigneeId", "chunkMin", "color", "createdAt", "dueAt", "durationMin", "energy", "hardDeadline", "id", "notes", "parentId", "priority", "projectId", "recurrenceRule", "startAt", "status", "timeSlotId", "timerStartedAt", "title", "trackedMinutes", "updatedAt", "userId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");
CREATE INDEX "Task_userId_dueAt_idx" ON "Task"("userId", "dueAt");
CREATE UNIQUE INDEX "Task_sourceSubscriptionId_sourceUid_key" ON "Task"("sourceSubscriptionId", "sourceUid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
