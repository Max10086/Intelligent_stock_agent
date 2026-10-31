import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThirteenFDistributionSlice } from '../../types/thirteenF.js';
import type { ThirteenFEdgarRawBundle } from '../lib/thirteenFEdgarClient.js';
import { getTickerSectorsFromDb } from './tickerSectorCacheService.js';

export interface TickerSectorInfo {
  sector: string;
  industry?: string;
}

export interface SectorLookupRequest {
  ticker: string;
  name: string;
}

const GENERIC_SECTORS = new Set(['Equity', 'ETF', 'Options', 'Other']);
const LLM_LOOKUP_SECTORS = new Set(['Equity', 'Other']);

/** Russell 3000 gsector column uses numeric GICS codes (e.g. 35.0 = Health Care). */
const GICS_SECTOR_CODE_TO_NAME: Record<string, string> = {
  '10': 'Energy',
  '15': 'Materials',
  '20': 'Industrials',
  '25': 'Consumer Discretionary',
  '30': 'Consumer Staples',
  '35': 'Health Care',
  '40': 'Financials',
  '45': 'Information Technology',
  '50': 'Communication Services',
  '55': 'Utilities',
  '60': 'Real Estate',
};

const NUMERIC_SECTOR_RE = /^\d+(\.0+)?$/;

export const normalizeSectorLabel = (sector: string): string => {
  const trimmed = sector.trim();
  if (!NUMERIC_SECTOR_RE.test(trimmed)) return trimmed;
  const code = String(parseInt(trimmed, 10));
  return GICS_SECTOR_CODE_TO_NAME[code] ?? trimmed;
};

export const bundleHasNumericSectorCodes = (bundle: {
  holdings: Array<{ sector: string }>;
}): boolean => bundle.holdings.some(row => NUMERIC_SECTOR_RE.test(row.sector.trim()));

export const isGenericSector = (sector: string): boolean => GENERIC_SECTORS.has(sector.trim());

export const needsLlmSectorLookup = (sector: string): boolean =>
  LLM_LOOKUP_SECTORS.has(sector.trim());

const STATIC_SECTOR_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../data/usTickerSectors.json'
);

const loadStaticSectorMap = (): Map<string, TickerSectorInfo> => {
  try {
    const raw = JSON.parse(readFileSync(STATIC_SECTOR_PATH, 'utf8')) as Record<
      string,
      TickerSectorInfo
    >;
    return new Map(
      Object.entries(raw).map(([ticker, info]) => [ticker.toUpperCase(), info] as const)
    );
  } catch (error) {
    console.warn(
      '[13f] static sector map unavailable:',
      error instanceof Error ? error.message : error
    );
    return new Map();
  }
};

const staticSectorMap = loadStaticSectorMap();

export const normalizeTicker = (ticker: string): string =>
  ticker.trim().toUpperCase().replace(/\./g, '-');

const distributionFromHoldings = (
  holdings: ThirteenFEdgarRawBundle['holdings'],
  totalAum: number
): { bySector: ThirteenFDistributionSlice[]; byStock: ThirteenFDistributionSlice[] } => {
  const sectorMap = new Map<string, number>();
  for (const row of holdings) {
    sectorMap.set(row.sector, (sectorMap.get(row.sector) ?? 0) + row.marketValueUsd);
  }

  const bySector = [...sectorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sector, marketValueUsd]) => ({
      key: sector,
      label: sector,
      marketValueUsd,
      weightPct: totalAum > 0 ? (marketValueUsd / totalAum) * 100 : 0,
    }));

  const byStock = holdings.slice(0, 40).map(row => ({
    key: row.ticker,
    label: row.ticker,
    marketValueUsd: row.marketValueUsd,
    weightPct: row.portfolioWeightPct,
  }));

  return { bySector, byStock };
};

const applySectorMap = (
  bundle: ThirteenFEdgarRawBundle,
  sectorMap: Map<string, TickerSectorInfo>
): ThirteenFEdgarRawBundle => {
  if (sectorMap.size === 0) return bundle;

  const holdings = bundle.holdings.map(row => {
    const info = sectorMap.get(normalizeTicker(row.ticker));
    const sector = normalizeSectorLabel(info?.sector ?? row.sector);
    return {
      ...row,
      sector,
      industry: info?.industry ?? row.industry,
    };
  });

  const changes = bundle.changes.map(row => ({
    ...row,
    sector: normalizeSectorLabel(
      sectorMap.get(normalizeTicker(row.ticker))?.sector ?? row.sector
    ),
  }));

  const enrichedSectors = new Set(holdings.map(row => row.sector));
  const hasRealSectors = [...enrichedSectors].some(sector => !GENERIC_SECTORS.has(sector));
  const totalAum = bundle.summary.totalMarketValueUsd;

  return {
    ...bundle,
    holdings,
    changes,
    distribution: distributionFromHoldings(holdings, totalAum),
    sectorsEnriched: hasRealSectors,
  };
};

const buildStaticSectorMap = (tickers: string[]): Map<string, TickerSectorInfo> => {
  const result = new Map<string, TickerSectorInfo>();
  for (const ticker of tickers) {
    const key = normalizeTicker(ticker);
    const info = staticSectorMap.get(key);
    if (info) result.set(key, info);
  }
  return result;
};

const collectTickers = (bundle: ThirteenFEdgarRawBundle): string[] =>
  [
    ...new Set([
      ...bundle.holdings.map(row => row.ticker),
      ...bundle.changes.map(row => row.ticker),
    ]),
  ].filter(Boolean);

/** Apply local ticker→GICS sector map (S&P + Russell + iShares IWM). */
export const applyStaticSectorEnrichment = (
  bundle: ThirteenFEdgarRawBundle
): ThirteenFEdgarRawBundle => {
  if (process.env.THIRTEEN_F_SECTOR_ENRICH === 'false') return bundle;
  if (bundle.sectorsEnriched && !bundleHasNumericSectorCodes(bundle)) return bundle;

  const tickers = collectTickers(bundle);
  const sectorMap = buildStaticSectorMap(tickers);
  if (sectorMap.size === 0) return bundle;

  return applySectorMap(bundle, sectorMap);
};

/** Apply persistent DB sector cache (includes prior LLM lookups). */
export const applyDbSectorEnrichment = async (
  bundle: ThirteenFEdgarRawBundle
): Promise<ThirteenFEdgarRawBundle> => {
  if (process.env.THIRTEEN_F_SECTOR_ENRICH === 'false') return bundle;

  const tickers = collectTickers(bundle);
  const dbMap = await getTickerSectorsFromDb(tickers);
  if (dbMap.size === 0) return bundle;

  return applySectorMap(bundle, dbMap);
};

/** Full sync enrichment: static JSON + DB cache. */
export const applySectorEnrichment = async (
  bundle: ThirteenFEdgarRawBundle
): Promise<ThirteenFEdgarRawBundle> => {
  const withStatic = applyStaticSectorEnrichment(bundle);
  return applyDbSectorEnrichment(withStatic);
};

/** Tickers still missing a real GICS sector after static + DB lookup. */
export const collectUnmappedSectorRequests = (
  bundle: ThirteenFEdgarRawBundle
): SectorLookupRequest[] => {
  const byTicker = new Map<string, string>();

  for (const row of bundle.holdings) {
    if (!needsLlmSectorLookup(row.sector)) continue;
    byTicker.set(normalizeTicker(row.ticker), row.name || row.ticker);
  }
  for (const row of bundle.changes) {
    if (!needsLlmSectorLookup(row.sector)) continue;
    byTicker.set(normalizeTicker(row.ticker), row.name || row.ticker);
  }

  return [...byTicker.entries()].map(([ticker, name]) => ({ ticker, name }));
};

export const countPendingSectorLookups = (bundle: ThirteenFEdgarRawBundle): number =>
  collectUnmappedSectorRequests(bundle).length;
