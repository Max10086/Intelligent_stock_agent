-- CreateTable
CREATE TABLE "ThirteenFBundleCache" (
    "id" TEXT NOT NULL,
    "cik" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "filingDate" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirteenFBundleCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThirteenFBundleCache_cik_quarter_key" ON "ThirteenFBundleCache"("cik", "quarter");

-- CreateIndex
CREATE INDEX "ThirteenFBundleCache_cik_quarter_idx" ON "ThirteenFBundleCache"("cik", "quarter" DESC);

-- CreateIndex
CREATE INDEX "ThirteenFBundleCache_expiresAt_idx" ON "ThirteenFBundleCache"("expiresAt");
