import type { GainerMarket } from '../../types/marketGainers.js';
import { prisma, withPrismaRetry } from '../db.js';
import { addToQueue } from '../actions/queue.js';
import { startQueueProcessing } from '../actions/process.js';
import { assertCanAnalyzeCompanies, UsageLimitError } from './usageLimit.js';
import { trackUserEvent } from './analytics.js';
import { isSuperAdminUser } from './adminAccess.js';
import {
  getUserGainerPreference,
  listAutoAnalyzeEligibleTickers,
  markAutoAnalyzeTriggered,
} from './marketGainersService.js';

export const runGainerAutoAnalyzeForAdmins = async () => {
  const admins = await withPrismaRetry(
    () =>
      prisma.user.findMany({
        where: { isAdmin: true },
        select: { id: true, email: true, isAdmin: true },
      }),
    'gainers.adminList',
    2
  );

  const eligibleAdmins = admins.filter(admin => isSuperAdminUser(admin));
  if (eligibleAdmins.length === 0) return { triggered: 0 };

  let triggered = 0;

  for (const admin of eligibleAdmins) {
    const pref = await getUserGainerPreference(admin.id);
    if (!pref.autoAnalyzeEnabled) continue;

    const markets = pref.autoAnalyzeMarkets.filter(
      (market): market is GainerMarket => market === 'US' || market === 'CN'
    );
    const tickers: string[] = [];

    for (const market of markets) {
      const rows = await listAutoAnalyzeEligibleTickers(
        market,
        pref.maxAutoTickersPerRun
      );
      tickers.push(...rows.map(row => row.ticker));
    }

    const uniqueTickers = Array.from(new Set(tickers.map(t => t.toUpperCase()))).slice(
      0,
      pref.maxAutoTickersPerRun
    );
    if (uniqueTickers.length === 0) continue;

    try {
      await assertCanAnalyzeCompanies(admin.id, uniqueTickers.length);
    } catch (error) {
      if (error instanceof UsageLimitError) {
        void trackUserEvent({
          userId: admin.id,
          eventType: 'gainer_auto_analyze_skipped',
          metadata: {
            reason: 'usage_limit',
            tickers: uniqueTickers,
          },
        });
        continue;
      }
      throw error;
    }

    const batchJob = await withPrismaRetry(
      () =>
        prisma.batchJob.create({
          data: {
            userId: admin.id,
            tickers: uniqueTickers.join(' '),
            language: pref.language,
            status: 'PENDING',
            source: 'gainer_auto',
          },
        }),
      'gainers.autoBatchCreate',
      2
    );

    await addToQueue(uniqueTickers, pref.language, batchJob.id, admin.id);
    startQueueProcessing();

    for (const market of markets) {
      await markAutoAnalyzeTriggered(market, uniqueTickers);
    }

    void trackUserEvent({
      userId: admin.id,
      eventType: 'gainer_auto_analyze',
      metadata: {
        batchJobId: batchJob.id,
        tickers: uniqueTickers,
      },
    });

    triggered += 1;
  }

  return { triggered };
};
