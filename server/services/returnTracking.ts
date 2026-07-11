import type {
  RecordReturnTrackingRequest,
  RecordReturnTrackingResponse,
  ReturnTrackingCompanyInput,
  ReturnTrackingCompanyResult,
  ReturnTrackingSourceType,
} from '../../types/returnTracking.js';
import { getQuotePrice } from '../../services/finance.js';
import { prisma, withPrismaRetry } from '../db.js';
import { computeReturnPct } from '../../utils/priceFormat.js';

const parseAnchorDate = (value: string): Date => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const fetchCurrentPrice = async (company: ReturnTrackingCompanyInput): Promise<string> => {
  try {
    const price = await getQuotePrice({
      ticker: company.ticker,
      exchange: company.exchange,
    });
    return price || company.anchorPrice;
  } catch (error) {
    console.warn(
      `[returnTracking] Failed to fetch price for ${company.ticker}:`,
      error instanceof Error ? error.message : error
    );
    return company.anchorPrice;
  }
};

const mapAnchorToResult = (
  anchor: {
    companyKey: string;
    ticker: string;
    exchange: string;
    companyName: string | null;
    anchorPrice: string;
    anchorDate: Date;
    snapshots: Array<{ observedDate: string; price: string; returnPct: number }>;
  }
): ReturnTrackingCompanyResult => {
  const snapshots = anchor.snapshots;
  const latest = snapshots[snapshots.length - 1];
  const currentPrice = latest?.price ?? anchor.anchorPrice;

  return {
    companyKey: anchor.companyKey,
    ticker: anchor.ticker,
    exchange: anchor.exchange,
    name: anchor.companyName || undefined,
    anchorPrice: anchor.anchorPrice,
    anchorDate: anchor.anchorDate.toISOString(),
    currentPrice,
    returnPct:
      latest?.returnPct ??
      computeReturnPct(anchor.anchorPrice, currentPrice),
    timeline: snapshots.map(snapshot => ({
      date: snapshot.observedDate,
      price: snapshot.price,
      returnPct: snapshot.returnPct,
    })),
  };
};

export class ReturnTrackingService {
  async getCached(
    userId: string,
    sourceType: ReturnTrackingSourceType,
    sourceId: string
  ): Promise<RecordReturnTrackingResponse> {
    const anchors = await withPrismaRetry(
      () =>
        prisma.returnTrackingAnchor.findMany({
          where: { userId, sourceType, sourceId },
          include: {
            snapshots: { orderBy: { observedDate: 'asc' } },
          },
        }),
      'returnTracking.getCached',
      2
    );

    return {
      companies: anchors.map(mapAnchorToResult),
    };
  }

  private async processCompanyOpen(
    userId: string,
    request: RecordReturnTrackingRequest,
    company: ReturnTrackingCompanyInput,
    observedDate: string
  ): Promise<ReturnTrackingCompanyResult> {
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
            anchorPrice: company.anchorPrice,
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

    return mapAnchorToResult({
      ...anchor,
      snapshots,
    });
  }

  async recordOpen(
    userId: string,
    request: RecordReturnTrackingRequest
  ): Promise<RecordReturnTrackingResponse> {
    const observedDate = request.observedDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) {
      throw new Error('observedDate must be YYYY-MM-DD');
    }

    const companies = request.companies
      .map(company => ({
        ...company,
        anchorPrice: company.anchorPrice?.trim() || '',
      }))
      .filter(company => company.anchorPrice);

    if (!companies.length) {
      return { companies: [] };
    }

    const results = await Promise.all(
      companies.map(company =>
        this.processCompanyOpen(userId, request, company, observedDate)
      )
    );

    return { companies: results };
  }
}

export const returnTrackingService = new ReturnTrackingService();
