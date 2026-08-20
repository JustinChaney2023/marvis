-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "dailyCapMin" INTEGER,
    "workDays" TEXT NOT NULL DEFAULT 'MO,TU,WE,TH,FR',
    "workStartMin" INTEGER NOT NULL DEFAULT 540,
    "workEndMin" INTEGER NOT NULL DEFAULT 1080,
    "localAiUrl" TEXT,
    "localAiModel" TEXT,
    "localAiApiKey" TEXT,
    "anthropicApiKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppSettings" ("anthropicApiKey", "bufferMin", "dailyCapMin", "id", "localAiApiKey", "localAiModel", "localAiUrl", "updatedAt", "userId") SELECT "anthropicApiKey", "bufferMin", "dailyCapMin", "id", "localAiApiKey", "localAiModel", "localAiUrl", "updatedAt", "userId" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_userId_key" ON "AppSettings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
