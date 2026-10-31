import type { ThirteenFQuarterId } from '../../types/thirteenF.js';
import { prisma, withPrismaRetry } from '../db.js';
import type { ThirteenFEdgarRawBundle } from '../lib/thirteenFEdgarClient.js';

/** 13F quarter snapshots are immutable once filed — keep in DB until manual refresh. */
const PERMANENT_EXPIRES_AT = new Date('2099-12-31T23:59:59.999Z');

export const normalizeThirteenFCik = (cik: string): string => cik.replace(/\D/g, '').padStart(10, '0');

/** @deprecated TTL no longer used; kept for status endpoint compatibility. */
export const getThirteenFCacheTtlMs = (): number => 0;

export const compareQuarters = (a: string, b: string): number => {
  const parse = (quarter: string): [number, number] => {
    const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
    if (!match) return [0, 0];
    return [Number(match[1]), Number(match[2])];
  };
  const [ay, aq] = parse(a);
  const [by, bq] = parse(b);
  if (ay !== by) return ay - by;
  return aq - bq;
};

const parsePayload = (payload: string): ThirteenFEdgarRawBundle | null => {
  try {
    return JSON.parse(payload) as ThirteenFEdgarRawBundle;
  } catch (error) {
    console.warn(
      '[13f-cache] Failed to parse cached payload:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

export const getThirteenFBundleFromDbCache = async (
  cik: string,
  quarter?: ThirteenFQuarterId | null
): Promise<ThirteenFEdgarRawBundle | null> => {
  const normalizedCik = normalizeThirteenFCik(cik);

  const row = await withPrismaRetry(async () => {
    if (quarter) {
      return prisma.thirteenFBundleCache.findUnique({
        where: {
          cik_quarter: {
            cik: normalizedCik,
            quarter,
          },
        },
      });
    }

    return prisma.thirteenFBundleCache.findFirst({
      where: { cik: normalizedCik },
      orderBy: { quarter: 'desc' },
    });
  }, '13f-cache.read');

  if (!row) {
    return null;
  }

  return parsePayload(row.payload);
};

export const getThirteenFBundleCacheMeta = async (
  cik: string,
  quarter?: ThirteenFQuarterId | null
): Promise<{ fetchedAt: string; quarter: ThirteenFQuarterId } | null> => {
  const normalizedCik = normalizeThirteenFCik(cik);

  const row = await withPrismaRetry(async () => {
    if (quarter) {
      return prisma.thirteenFBundleCache.findUnique({
        where: { cik_quarter: { cik: normalizedCik, quarter } },
        select: { fetchedAt: true, quarter: true },
      });
    }

    return prisma.thirteenFBundleCache.findFirst({
      where: { cik: normalizedCik },
      orderBy: { quarter: 'desc' },
      select: { fetchedAt: true, quarter: true },
    });
  }, '13f-cache.meta');

  if (!row) return null;

  return {
    fetchedAt: row.fetchedAt.toISOString(),
    quarter: row.quarter as ThirteenFQuarterId,
  };
};

export const saveThirteenFBundleToDbCache = async (
  bundle: ThirteenFEdgarRawBundle
): Promise<void> => {
  const cik = normalizeThirteenFCik(bundle.summary.cik);
  const quarter = bundle.summary.quarter;
  const fetchedAt = new Date();

  await withPrismaRetry(
    () =>
      prisma.thirteenFBundleCache.upsert({
        where: {
          cik_quarter: { cik, quarter },
        },
        create: {
          cik,
          quarter,
          institutionName: bundle.summary.institutionName,
          filingDate: bundle.summary.filingDate,
          payload: JSON.stringify(bundle),
          fetchedAt,
          expiresAt: PERMANENT_EXPIRES_AT,
        },
        update: {
          institutionName: bundle.summary.institutionName,
          filingDate: bundle.summary.filingDate,
          payload: JSON.stringify(bundle),
          fetchedAt,
          expiresAt: PERMANENT_EXPIRES_AT,
        },
      }),
    '13f-cache.write'
  );
};

/** Legacy cleanup for rows saved before permanent-cache policy. */
export const purgeExpiredThirteenFCache = async (): Promise<number> => {
  const result = await withPrismaRetry(
    () =>
      prisma.thirteenFBundleCache.deleteMany({
        where: {
          expiresAt: { lte: new Date() },
        },
      }),
    '13f-cache.purge'
  );
  return result.count;
};

export const isThirteenFHistoricalQuarterPermanent = (): boolean => true;

export const isThirteenFCacheManualRefreshOnly = (): boolean => true;
