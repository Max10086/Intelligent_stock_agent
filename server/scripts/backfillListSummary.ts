/**
 * One-time backfill: populate AnalysisJob.listSummary from result JSON.
 * Run: npx tsx server/scripts/backfillListSummary.ts
 */
import 'dotenv/config';
import { prisma, withPrismaRetry } from '../db.js';
import type { AnalysisState } from '../../types.js';
import { buildHistoryListSummary } from '../../utils/historyListSummary.js';

async function main() {
  const pending = await withPrismaRetry(
    () =>
      prisma.analysisJob.findMany({
        where: {
          status: 'COMPLETED',
          result: { not: null },
          listSummary: null,
        },
        select: { id: true },
        orderBy: { completedAt: 'desc' },
      }),
    'backfill.ids',
    3
  );

  console.log(`Found ${pending.length} jobs missing listSummary`);

  let updated = 0;
  let failed = 0;

  for (const { id } of pending) {
    try {
      const job = await withPrismaRetry(
        () =>
          prisma.analysisJob.findUnique({
            where: { id },
            select: { result: true },
          }),
        `backfill.${id.slice(0, 8)}`,
        2
      );
      if (!job?.result) continue;

      const parsed = JSON.parse(job.result) as AnalysisState;
      const listSummary = buildHistoryListSummary(parsed);
      await withPrismaRetry(
        () =>
          prisma.analysisJob.update({
            where: { id },
            data: { listSummary },
          }),
        `backfill.save.${id.slice(0, 8)}`,
        2
      );
      updated += 1;
      console.log(`  ✓ ${id} (${listSummary.length} chars)`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`Done: ${updated} updated, ${failed} failed`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
