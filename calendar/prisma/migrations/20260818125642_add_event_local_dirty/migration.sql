-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recurrenceRule" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LOCAL',
    "googleEventId" TEXT,
    "googleUpdatedAt" DATETIME,
    "localDirty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("allDay", "createdAt", "end", "googleEventId", "googleUpdatedAt", "id", "locked", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt") SELECT "allDay", "createdAt", "end", "googleEventId", "googleUpdatedAt", "id", "locked", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_taskId_key" ON "Event"("taskId");
CREATE UNIQUE INDEX "Event_googleEventId_key" ON "Event"("googleEventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
