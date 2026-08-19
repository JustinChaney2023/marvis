-- CreateTable
CREATE TABLE "BookingLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "dailyCapMin" INTEGER,
    "localAiUrl" TEXT,
    "localAiModel" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppSettings" ("bufferMin", "dailyCapMin", "id", "localAiModel", "localAiUrl", "updatedAt", "userId") SELECT "bufferMin", "dailyCapMin", "id", "localAiModel", "localAiUrl", "updatedAt", "userId" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_userId_key" ON "AppSettings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_slug_key" ON "BookingLink"("slug");

