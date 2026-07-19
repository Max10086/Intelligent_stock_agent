-- AlterTable
ALTER TABLE "BatchJob" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- CreateEnum
CREATE TYPE "GainerMarket" AS ENUM ('US', 'CN', 'HK');

-- CreateEnum
CREATE TYPE "GainerPeriod" AS ENUM ('DAILY', 'WEEKLY', 'THREE_DAY');

-- CreateTable
CREATE TABLE "MarketGainerSnapshot" (
    "id" TEXT NOT NULL,
    "market" "GainerMarket" NOT NULL,
    "period" "GainerPeriod" NOT NULL,
    "tradingDateEnd" TEXT NOT NULL,
    "tradingDateStart" TEXT,
    "modelProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "rawResponse" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketGainerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketGainerEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT,
    "changePct" DOUBLE PRECISION NOT NULL,
    "blurb" TEXT NOT NULL,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketGainerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketGainerAppearance" (
    "id" TEXT NOT NULL,
    "market" "GainerMarket" NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appearanceScore" INTEGER NOT NULL DEFAULT 0,
    "dailyAppearances14d" INTEGER NOT NULL DEFAULT 0,
    "weeklyAppearances14d" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "autoAnalyzeEligible" BOOLEAN NOT NULL DEFAULT false,
    "autoAnalyzeTriggeredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketGainerAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGainerPreference" (
    "userId" TEXT NOT NULL,
    "autoAnalyzeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoAnalyzeMarkets" TEXT NOT NULL DEFAULT 'US,CN',
    "minAppearanceScore" INTEGER NOT NULL DEFAULT 2,
    "maxAutoTickersPerRun" INTEGER NOT NULL DEFAULT 5,
    "language" TEXT NOT NULL DEFAULT 'cn',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGainerPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketGainerSnapshot_market_period_tradingDateEnd_key" ON "MarketGainerSnapshot"("market", "period", "tradingDateEnd");

-- CreateIndex
CREATE INDEX "MarketGainerSnapshot_market_period_fetchedAt_idx" ON "MarketGainerSnapshot"("market", "period", "fetchedAt");

-- CreateIndex
CREATE INDEX "MarketGainerEntry_ticker_createdAt_idx" ON "MarketGainerEntry"("ticker", "createdAt");

-- CreateIndex
CREATE INDEX "MarketGainerEntry_snapshotId_rank_idx" ON "MarketGainerEntry"("snapshotId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "MarketGainerAppearance_market_ticker_key" ON "MarketGainerAppearance"("market", "ticker");

-- CreateIndex
CREATE INDEX "MarketGainerAppearance_appearanceScore_idx" ON "MarketGainerAppearance"("appearanceScore");

-- CreateIndex
CREATE INDEX "MarketGainerAppearance_autoAnalyzeEligible_idx" ON "MarketGainerAppearance"("autoAnalyzeEligible");

-- AddForeignKey
ALTER TABLE "MarketGainerEntry" ADD CONSTRAINT "MarketGainerEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketGainerSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGainerPreference" ADD CONSTRAINT "UserGainerPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
