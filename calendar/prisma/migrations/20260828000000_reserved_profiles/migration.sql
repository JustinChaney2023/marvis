-- CreateTable
CREATE TABLE "ReservedProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservedProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable (implicit m2m for Label <-> ReservedProfile.exemptLabels)
CREATE TABLE "_ReservedProfileExemptLabels" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ReservedProfileExemptLabels_A_fkey" FOREIGN KEY ("A") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ReservedProfileExemptLabels_B_fkey" FOREIGN KEY ("B") REFERENCES "ReservedProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "_ReservedProfileExemptLabels_AB_unique" ON "_ReservedProfileExemptLabels"("A", "B");
CREATE INDEX "_ReservedProfileExemptLabels_B_index" ON "_ReservedProfileExemptLabels"("B");

-- Data migration: give every user with existing ReservedBlock rows a
-- "Work" profile to own them, before reshaping the table to belong to a
-- profile instead of directly to a user.
INSERT INTO "ReservedProfile" ("id", "userId", "name", "createdAt", "updatedAt")
SELECT DISTINCT 'migrated_' || "userId", "userId", 'Work', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ReservedBlock";

-- RedefineTables: ReservedBlock now belongs to a profile, not directly to a user
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReservedBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservedBlock_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ReservedProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReservedBlock" ("id", "profileId", "dayOfWeek", "startMin", "endMin", "createdAt", "updatedAt")
SELECT "id", 'migrated_' || "userId", "dayOfWeek", "startMin", "endMin", "createdAt", "updatedAt" FROM "ReservedBlock";
DROP TABLE "ReservedBlock";
ALTER TABLE "new_ReservedBlock" RENAME TO "ReservedBlock";
CREATE INDEX "ReservedBlock_profileId_idx" ON "ReservedBlock"("profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables: drop Project.isWorkTag, no longer used
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'zinc',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("id", "userId", "name", "color", "notes", "createdAt")
SELECT "id", "userId", "name", "color", "notes", "createdAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
