import type {
  RecordReturnTrackingRequest,
  RecordReturnTrackingResponse,
  ReturnTrackingCompanyInput,
  ReturnTrackingCompanyResult,
} from '../../types/returnTracking.js';
import { getFinancialData } from '../../services/finance.js';
import { prisma, withPrismaRetry } from '../db.js';
import { computeReturnPct } from '../../utils/priceFormat.js';

const parseAnchorDate = (value: string): Date => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const fetchCurrentPrice = async (company: ReturnTrackingCompanyInput): Promise<string> => {
  try {
    const profile = await getFinancialData({
      ticker: company.ticker,
      exchange: company.exchange,
      name: company.name || company.ticker,
    });
    return profile.currentPrice || company.anchorPrice;
  } catch (error) {
    console.warn(
      `[returnTracking] Failed to fetch price for ${company.ticker}:`,
      error instanceof Error ? error.message : error
    );
    return company.anchorPrice;
  }
};

export class ReturnTrackingService {
  async recordOpen(
    userId: string,
    request: RecordReturnTrackingRequest
  ): Promise<RecordReturnTrackingResponse> {
    const observedDate = request.observedDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) {
      throw new Error('observedDate must be YYYY-MM-DD');
    }
    if (!request.companies.length) {
      return { companies: [] };
    }

    const results: ReturnTrackingCompanyResult[] = [];

    for (const company of request.companies) {
      const anchorPrice = company.anchorPrice?.trim();
      if (!anchorPrice) continue;

      const anchor = await withPrismaRetry(
        () =>
          prisma.returnTrackingAnchor.upsert({
            where: {
              sourceType_sourceId_companyKey: {
                sourceType: request.sourceType,
                sourceId: request.sourceId,
                companyKey: company.companyKey,
              },
            },
            create: {
              userId,
              sourceType: request.sourceType,
              sourceId: request.sourceId,
              companyKey: company.companyKey,
              ticker: company.ticker,
              exchange: company.exchange,
              companyName: company.name || null,
              anchorPrice,
              anchorDate: parseAnchorDate(company.anchorDate),
            },
            update: {
              ticker: company.ticker,
              exchange: company.exchange,
              companyName: company.name || null,
            },
          }),
        'returnTracking.upsertAnchor',
        2
      );

      const currentPrice = await fetchCurrentPrice(company);
      const returnPct = computeReturnPct(anchor.anchorPrice, currentPrice);

      await withPrismaRetry(
        () =>
          prisma.returnTrackingSnapshot.upsert({
            where: {
              anchorId_observedDate: {
                anchorId: anchor.id,
                observedDate,
              },
            },
            create: {
              anchorId: anchor.id,
              observedDate,
              price: currentPrice,
              returnPct: returnPct ?? 0,
            },
            update: {
              price: currentPrice,
              returnPct: returnPct ?? 0,
            },
          }),
        'returnTracking.upsertSnapshot',
        2
      );

      const snapshots = await withPrismaRetry(
        () =>
          prisma.returnTrackingSnapshot.findMany({
            where: { anchorId: anchor.id },
            orderBy: { observedDate: 'asc' },
          }),
        'returnTracking.listSnapshots',
        2
      );

      results.push({
        companyKey: company.companyKey,
        ticker: anchor.ticker,
        exchange: anchor.exchange,
        name: anchor.companyName || company.name,
        anchorPrice: anchor.anchorPrice,
        anchorDate: anchor.anchorDate.toISOString(),
        currentPrice,
        returnPct,
        timeline: snapshots.map(snapshot => ({
          date: snapshot.observedDate,
          price: snapshot.price,
          returnPct: snapshot.returnPct,
        })),
      });
    }

    return { companies: results };
  }
}

export const returnTrackingService = new ReturnTrackingService();
