-- CreateTable
CREATE TABLE "BatchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tickers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
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
    "result" TEXT,
    CONSTRAINT "AnalysisJob_batchJobId_fkey" FOREIGN KEY ("batchJobId") REFERENCES "BatchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BatchJob_status_idx" ON "BatchJob"("status");

-- CreateIndex
CREATE INDEX "BatchJob_createdAt_idx" ON "BatchJob"("createdAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_status_idx" ON "AnalysisJob"("status");

-- CreateIndex
CREATE INDEX "AnalysisJob_createdAt_idx" ON "AnalysisJob"("createdAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_batchJobId_idx" ON "AnalysisJob"("batchJobId");
