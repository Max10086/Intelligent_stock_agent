-- CreateTable
CREATE TABLE "TickerSectorCache" (
    "ticker" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "industry" TEXT,
    "companyName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TickerSectorCache_pkey" PRIMARY KEY ("ticker")
);

-- CreateIndex
CREATE INDEX "TickerSectorCache_sector_idx" ON "TickerSectorCache"("sector");

-- CreateIndex
CREATE INDEX "TickerSectorCache_updatedAt_idx" ON "TickerSectorCache"("updatedAt" DESC);
