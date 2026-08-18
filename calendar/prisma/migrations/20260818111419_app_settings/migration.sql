-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);
