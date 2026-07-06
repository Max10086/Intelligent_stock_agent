-- CreateEnum
CREATE TYPE "CompareRunStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "ComparisonRun" ADD COLUMN "status" "CompareRunStatus" NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "ComparisonRun" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ComparisonRun" ADD COLUMN "currentStep" TEXT;
ALTER TABLE "ComparisonRun" ADD COLUMN "error" TEXT;

-- CreateIndex
CREATE INDEX "ComparisonRun_status_idx" ON "ComparisonRun"("status");
