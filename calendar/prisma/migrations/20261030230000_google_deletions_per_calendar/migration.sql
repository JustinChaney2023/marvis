-- GoogleDeletion was keyed by account (main's 20261030221808); Season syncs
-- per GoogleCalendar, so key it by that instead. The table is a transient
-- queue (drained on every sync), so recreating it is safe.
DROP TABLE "GoogleDeletion";

CREATE TABLE "GoogleDeletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleCalendarId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "GoogleDeletion_googleCalendarId_googleEventId_key" ON "GoogleDeletion"("googleCalendarId", "googleEventId");
