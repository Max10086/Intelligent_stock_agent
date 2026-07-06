import 'dotenv/config';
import { prisma } from '../db.js';

const TARGET_EMAIL = process.argv[2] || 'yepu100@163.com';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(`User not found in app database: ${TARGET_EMAIL}`);
  }

  const targetId = user.id;
  console.log(`Assigning all historical data to ${TARGET_EMAIL} (${targetId})`);

  const usageConflicts = await prisma.$executeRaw`
    DELETE FROM "CompanyAnalysisUsage" AS target
    USING "CompanyAnalysisUsage" AS source
    WHERE target."userId" = ${targetId}
      AND source."userId" IS DISTINCT FROM ${targetId}
      AND target."reportId" = source."reportId"
      AND target."companyId" = source."companyId"
      AND target."usageDate" = source."usageDate"
  `;

  const usage = await prisma.companyAnalysisUsage.updateMany({
    where: { NOT: { userId: targetId } },
    data: { userId: targetId },
  });

  const jobs = await prisma.analysisJob.updateMany({
    where: { OR: [{ userId: null }, { NOT: { userId: targetId } }] },
    data: { userId: targetId },
  });

  const compareSessions = await prisma.comparisonSession.updateMany({
    where: { OR: [{ userId: null }, { NOT: { userId: targetId } }] },
    data: { userId: targetId },
  });

  const batchJobs = await prisma.batchJob.updateMany({
    where: { OR: [{ userId: null }, { NOT: { userId: targetId } }] },
    data: { userId: targetId },
  });

  const returnAnchors = await prisma.returnTrackingAnchor.updateMany({
    where: { OR: [{ userId: null }, { NOT: { userId: targetId } }] },
    data: { userId: targetId },
  });

  const userEvents = await prisma.userEvent.updateMany({
    where: { NOT: { userId: targetId } },
    data: { userId: targetId },
  });

  const result = {
    usageConflicts,
    usage,
    jobs,
    compareSessions,
    batchJobs,
    returnAnchors,
    userEvents,
  };

  const verify = {
    jobs: await prisma.analysisJob.groupBy({ by: ['userId'], _count: true }),
    compare: await prisma.comparisonSession.groupBy({ by: ['userId'], _count: true }),
    batch: await prisma.batchJob.groupBy({ by: ['userId'], _count: true }),
    returnAnchors: await prisma.returnTrackingAnchor.groupBy({ by: ['userId'], _count: true }),
    usage: await prisma.companyAnalysisUsage.groupBy({ by: ['userId'], _count: true }),
    completedForUser: await prisma.analysisJob.count({
      where: { userId: targetId, status: 'COMPLETED', result: { not: null } },
    }),
    compareForUser: await prisma.comparisonSession.count({ where: { userId: targetId } }),
  };

  console.log('Migration result:', result);
  console.log('Verify:', verify);
}

main()
  .catch(error => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
