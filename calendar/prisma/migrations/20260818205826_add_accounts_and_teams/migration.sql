-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "type" TEXT NOT NULL DEFAULT 'HUMAN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Assignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'SUGGESTION',
    "message" TEXT NOT NULL,
    "page" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "bufferMin" INTEGER NOT NULL DEFAULT 10,
    "bookingSlug" TEXT,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingDurationMin" INTEGER NOT NULL DEFAULT 30,
    "bookingTitle" TEXT NOT NULL DEFAULT 'Book time with me',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppSettings" ("bookingDurationMin", "bookingEnabled", "bookingSlug", "bookingTitle", "bufferMin", "id", "updatedAt") SELECT "bookingDurationMin", "bookingEnabled", "bookingSlug", "bookingTitle", "bufferMin", "id", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_userId_key" ON "AppSettings"("userId");
CREATE UNIQUE INDEX "AppSettings_bookingSlug_key" ON "AppSettings"("bookingSlug");
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recurrenceRule" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LOCAL',
    "googleEventId" TEXT,
    "googleUpdatedAt" DATETIME,
    "localDirty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("allDay", "createdAt", "end", "googleEventId", "googleUpdatedAt", "id", "localDirty", "locked", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt") SELECT "allDay", "createdAt", "end", "googleEventId", "googleUpdatedAt", "id", "localDirty", "locked", "notes", "recurrenceRule", "source", "start", "taskId", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE UNIQUE INDEX "Event_taskId_key" ON "Event"("taskId");
CREATE UNIQUE INDEX "Event_googleEventId_key" ON "Event"("googleEventId");
CREATE TABLE "new_GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GoogleAccount" ("accessToken", "calendarId", "createdAt", "email", "expiresAt", "id", "lastSyncedAt", "refreshToken", "updatedAt") SELECT "accessToken", "calendarId", "createdAt", "email", "expiresAt", "id", "lastSyncedAt", "refreshToken", "updatedAt" FROM "GoogleAccount";
DROP TABLE "GoogleAccount";
ALTER TABLE "new_GoogleAccount" RENAME TO "GoogleAccount";
CREATE UNIQUE INDEX "GoogleAccount_userId_key" ON "GoogleAccount"("userId");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'zinc',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("color", "createdAt", "id", "name") SELECT "color", "createdAt", "id", "name" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "energy" TEXT NOT NULL DEFAULT 'MEDIUM',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "dueAt" DATETIME,
    "recurrenceRule" TEXT,
    "projectId" TEXT,
    "assigneeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Assignee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("createdAt", "dueAt", "durationMin", "energy", "id", "notes", "priority", "projectId", "recurrenceRule", "status", "title", "updatedAt") SELECT "createdAt", "dueAt", "durationMin", "energy", "id", "notes", "priority", "projectId", "recurrenceRule", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
