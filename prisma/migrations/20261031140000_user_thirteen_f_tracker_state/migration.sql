-- CreateTable
CREATE TABLE "UserThirteenFTrackerState" (
    "userId" TEXT NOT NULL,
    "watchlistJson" TEXT NOT NULL DEFAULT '[]',
    "starredCiksJson" TEXT NOT NULL DEFAULT '[]',
    "stakeCiksJson" TEXT NOT NULL DEFAULT '[]',
    "stakeLookbackDays" INTEGER NOT NULL DEFAULT 180,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserThirteenFTrackerState_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserThirteenFTrackerState" ADD CONSTRAINT "UserThirteenFTrackerState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
