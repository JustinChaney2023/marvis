-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "bookingSlug" TEXT,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingDurationMin" INTEGER NOT NULL DEFAULT 30,
    "bookingTitle" TEXT NOT NULL DEFAULT 'Book time with me',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("bufferMin", "id", "updatedAt") SELECT "bufferMin", "id", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_bookingSlug_key" ON "AppSettings"("bookingSlug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
