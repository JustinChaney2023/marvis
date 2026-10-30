-- DropIndex
DROP INDEX "Event_appleEventUid_key";

-- CreateIndex
CREATE UNIQUE INDEX "Event_userId_appleEventUid_key" ON "Event"("userId", "appleEventUid");

