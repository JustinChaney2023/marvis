-- CreateTable
CREATE TABLE "GoogleDeletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleAccountId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDeletion_googleAccountId_googleEventId_key" ON "GoogleDeletion"("googleAccountId", "googleEventId");
