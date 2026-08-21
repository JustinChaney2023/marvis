-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'BUSY_ONLY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenByRecipient" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CalendarShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarShare" ("createdAt", "id", "ownerId", "permission", "sharedWithId") SELECT "createdAt", "id", "ownerId", "permission", "sharedWithId" FROM "CalendarShare";
DROP TABLE "CalendarShare";
ALTER TABLE "new_CalendarShare" RENAME TO "CalendarShare";
CREATE UNIQUE INDEX "CalendarShare_ownerId_sharedWithId_key" ON "CalendarShare"("ownerId", "sharedWithId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
