-- AlterTable
ALTER TABLE "Event" ADD COLUMN "appleEventUid" TEXT;

-- CreateTable
CREATE TABLE "AppleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "appleId" TEXT NOT NULL,
    "appPassword" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AppleAccount_userId_key" ON "AppleAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_appleEventUid_key" ON "Event"("appleEventUid");

