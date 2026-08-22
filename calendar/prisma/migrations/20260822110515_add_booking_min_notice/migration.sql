-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BookingLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "excludeDays" TEXT,
    "minNoticeMin" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BookingLink" ("createdAt", "durationMin", "enabled", "excludeDays", "id", "slug", "title", "updatedAt", "userId") SELECT "createdAt", "durationMin", "enabled", "excludeDays", "id", "slug", "title", "updatedAt", "userId" FROM "BookingLink";
DROP TABLE "BookingLink";
ALTER TABLE "new_BookingLink" RENAME TO "BookingLink";
CREATE UNIQUE INDEX "BookingLink_slug_key" ON "BookingLink"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
