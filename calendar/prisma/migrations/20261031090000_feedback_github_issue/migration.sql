-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "githubIssueNumber" INTEGER;
ALTER TABLE "Feedback" ADD COLUMN "githubIssueUrl" TEXT;
ALTER TABLE "Feedback" ADD COLUMN "sentToClaudeAt" DATETIME;
