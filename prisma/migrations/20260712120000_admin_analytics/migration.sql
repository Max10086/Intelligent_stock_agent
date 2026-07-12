-- AlterTable
ALTER TABLE "User" ADD COLUMN "firstAnalysisAt" TIMESTAMP(3),
ADD COLUMN "paidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rating" INTEGER,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_firstAnalysisAt_idx" ON "User"("firstAnalysisAt");

-- CreateIndex
CREATE INDEX "User_paidAt_idx" ON "User"("paidAt");

-- CreateIndex
CREATE INDEX "UserFeedback_userId_createdAt_idx" ON "UserFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFeedback_category_createdAt_idx" ON "UserFeedback"("category", "createdAt");

-- CreateIndex
CREATE INDEX "UserFeedback_createdAt_idx" ON "UserFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill paidAt from subscription events where possible
UPDATE "User" u
SET "paidAt" = sub.first_paid
FROM (
  SELECT "userId", MIN("createdAt") AS first_paid
  FROM "UserEvent"
  WHERE "eventType" = 'subscription_activated'
  GROUP BY "userId"
) sub
WHERE u.id = sub."userId" AND u."paidAt" IS NULL;

-- Backfill firstAnalysisAt from usage records
UPDATE "User" u
SET "firstAnalysisAt" = sub.first_used
FROM (
  SELECT "userId", MIN("createdAt") AS first_used
  FROM "CompanyAnalysisUsage"
  GROUP BY "userId"
) sub
WHERE u.id = sub."userId" AND u."firstAnalysisAt" IS NULL;
