-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "dailyCapMin" INTEGER,
    "autoSchedule" BOOLEAN NOT NULL DEFAULT false,
    "workDays" TEXT NOT NULL DEFAULT 'MO,TU,WE,TH,FR',
    "workStartMin" INTEGER NOT NULL DEFAULT 540,
    "workEndMin" INTEGER NOT NULL DEFAULT 1080,
    "secondaryTimezone" TEXT,
    "localAiUrl" TEXT,
    "localAiModel" TEXT,
    "localAiApiKey" TEXT,
    "anthropicApiKey" TEXT,
    "transcribeUrl" TEXT,
    "transcribeModel" TEXT,
    "transcribeApiKey" TEXT,
    "markitdownUrl" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppSettings" ("anthropicApiKey", "bufferMin", "dailyCapMin", "id", "localAiApiKey", "localAiModel", "localAiUrl", "markitdownUrl", "secondaryTimezone", "transcribeApiKey", "transcribeModel", "transcribeUrl", "updatedAt", "userId", "workDays", "workEndMin", "workStartMin") SELECT "anthropicApiKey", "bufferMin", "dailyCapMin", "id", "localAiApiKey", "localAiModel", "localAiUrl", "markitdownUrl", "secondaryTimezone", "transcribeApiKey", "transcribeModel", "transcribeUrl", "updatedAt", "userId", "workDays", "workEndMin", "workStartMin" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_userId_key" ON "AppSettings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
