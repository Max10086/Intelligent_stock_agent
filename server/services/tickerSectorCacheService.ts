import { prisma, withPrismaRetry } from '../db.js';
import type { TickerSectorInfo } from './thirteenFSectorEnrichment.js';

export type TickerSectorSource = 'static' | 'llm' | 'manual';

export interface TickerSectorRecord extends TickerSectorInfo {
  ticker: string;
  companyName?: string;
  source: TickerSectorSource;
}

const normalizeTicker = (ticker: string): string => ticker.trim().toUpperCase().replace(/\./g, '-');

export const getTickerSectorsFromDb = async (
  tickers: string[]
): Promise<Map<string, TickerSectorInfo>> => {
  const keys = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  if (keys.length === 0) return new Map();

  const rows = await withPrismaRetry(
    () =>
      prisma.tickerSectorCache.findMany({
        where: { ticker: { in: keys } },
        select: { ticker: true, sector: true, industry: true },
      }),
    'ticker-sector.read'
  );

  return new Map(
    rows.map(row => [row.ticker, { sector: row.sector, industry: row.industry ?? undefined }] as const)
  );
};

export const saveTickerSectorsToDb = async (
  entries: Array<{
    ticker: string;
    sector: string;
    industry?: string;
    companyName?: string;
    source?: TickerSectorSource;
  }>
): Promise<number> => {
  let saved = 0;
  for (const entry of entries) {
    const ticker = normalizeTicker(entry.ticker);
    const sector = entry.sector.trim();
    if (!ticker || !sector) continue;

    await withPrismaRetry(
      () =>
        prisma.tickerSectorCache.upsert({
          where: { ticker },
          create: {
            ticker,
            sector,
            industry: entry.industry?.trim() || null,
            companyName: entry.companyName?.trim() || null,
            source: entry.source ?? 'llm',
          },
          update: {
            sector,
            industry: entry.industry?.trim() || null,
            companyName: entry.companyName?.trim() || null,
            source: entry.source ?? 'llm',
            updatedAt: new Date(),
          },
        }),
      'ticker-sector.write'
    );
    saved += 1;
  }
  return saved;
};
