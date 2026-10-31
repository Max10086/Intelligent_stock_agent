-- CreateTable
CREATE TABLE "ThirteenFStakeFilingCache" (
    "accessionNumber" TEXT NOT NULL,
    "filerCik" TEXT NOT NULL,
    "filerName" TEXT,
    "targetCompanyCik" TEXT,
    "targetCompanyName" TEXT,
    "fileNumber" TEXT,
    "formType" TEXT NOT NULL,
    "filingDate" TEXT NOT NULL,
    "ownershipPct" DOUBLE PRECISION,
    "priorOwnershipPct" DOUBLE PRECISION,
    "sharesOwned" DOUBLE PRECISION,
    "stakeChangeType" TEXT,
    "item4Text" TEXT,
    "item4Summary" TEXT,
    "item4SummaryStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirteenFStakeFilingCache_pkey" PRIMARY KEY ("accessionNumber")
);

-- CreateIndex
CREATE INDEX "ThirteenFStakeFilingCache_filerCik_targetCompanyCik_filingDate_idx" ON "ThirteenFStakeFilingCache"("filerCik", "targetCompanyCik", "filingDate" DESC);

-- CreateIndex
CREATE INDEX "ThirteenFStakeFilingCache_filerCik_targetCompanyName_filingDate_idx" ON "ThirteenFStakeFilingCache"("filerCik", "targetCompanyName", "filingDate" DESC);

-- CreateIndex
CREATE INDEX "ThirteenFStakeFilingCache_fileNumber_filingDate_idx" ON "ThirteenFStakeFilingCache"("fileNumber", "filingDate" DESC);
