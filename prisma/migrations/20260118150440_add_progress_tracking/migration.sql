-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalysisJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchJobId" TEXT,
    "ticker" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "logs" TEXT,
    "result" TEXT,
    CONSTRAINT "AnalysisJob_batchJobId_fkey" FOREIGN KEY ("batchJobId") REFERENCES "BatchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnalysisJob" ("batchJobId", "completedAt", "createdAt", "error", "id", "language", "query", "result", "startedAt", "status", "ticker", "updatedAt") SELECT "batchJobId", "completedAt", "createdAt", "error", "id", "language", "query", "result", "startedAt", "status", "ticker", "updatedAt" FROM "AnalysisJob";
DROP TABLE "AnalysisJob";
ALTER TABLE "new_AnalysisJob" RENAME TO "AnalysisJob";
CREATE INDEX "AnalysisJob_status_idx" ON "AnalysisJob"("status");
CREATE INDEX "AnalysisJob_createdAt_idx" ON "AnalysisJob"("createdAt");
CREATE INDEX "AnalysisJob_batchJobId_idx" ON "AnalysisJob"("batchJobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
