-- DropIndex
DROP INDEX "Event_taskId_key";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "chunkMin" INTEGER;
