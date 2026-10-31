import type {
  ThirteenFHoldingsResponse,
  ThirteenFHoldingSortField,
  ThirteenFPositionChangesResponse,
  ThirteenFQuarterId,
  ThirteenFSectorEnrichmentStatus,
  ThirteenFSortDirection,
} from '../../types/thirteenF.js';
import {
  fetchThirteenFBundleViaPython,
  isThirteenFEdgarConfigured,
  type ThirteenFEdgarRawBundle,
} from '../lib/thirteenFEdgarClient.js';
import {
  getThirteenFBundleFromDbCache,
  getThirteenFBundleCacheMeta,
  isThirteenFCacheManualRefreshOnly,
  isThirteenFHistoricalQuarterPermanent,
  saveThirteenFBundleToDbCache,
} from './thirteenFCacheService.js';
import {
  clearThirteenFMemoryCacheEntry,
  getThirteenFMemoryCacheTtlMinutes,
  invalidateThirteenFMemoryCache,
  memoryCacheKey,
  readThirteenFMemoryCache,
  writeThirteenFMemoryCache,
} from './thirteenFMemoryCache.js';
import { computeChangeCounts } from '../../utils/thirteenFFormat.js';
import { sortHoldingsRows } from '../../utils/thirteenFHoldingsSort.js';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { fetchSecCompanyProfile } from '../lib/secSubmissionsClient.js';
import {
  applySectorEnrichment,
  bundleHasNumericSectorCodes,
  countPendingSectorLookups,
} from './thirteenFSectorEnrichment.js';
import {
  getSectorEnrichmentState,
  scheduleBackgroundSectorEnrichment,
  type SectorEnrichmentState,
} from './thirteenFSectorEnrichmentJob.js';

/** Bump when cached bundle shape changes — stale rows are refetched from SEC. */
const BUNDLE_SCHEMA_VERSION = 6;

const inflightFetches = new Map<string, Promise<ThirteenFEdgarRawBundle>>();

const bundleHasHoldingsDeltas = (bundle: ThirteenFEdgarRawBundle): boolean =>
  bundle.holdings.some(
    row => row.marketValueDeltaUsd != null || row.sharesDelta != null || row.weightDeltaPct != null
  );

/** Pre-v2 DB cache entries lack quarter-over-quarter fields on holdings. */
const isStaleHoldingsCache = (bundle: ThirteenFEdgarRawBundle): boolean => {
  if ((bundle.schemaVersion ?? 0) >= BUNDLE_SCHEMA_VERSION) {
    return false;
  }
  if (bundle.priorQuarter === bundle.summary.quarter) {
    return false;
  }
  if (!bundleHasHoldingsDeltas(bundle)) {
    return true;
  }
  const seen = new Set<string>();
  for (const row of bundle.holdings) {
    if (seen.has(row.ticker)) return true;
    seen.add(row.ticker);
  }
  if (bundleHasNumericSectorCodes(bundle)) return true;
  return false;
};

const readMemoryCache = (key: string): ThirteenFEdgarRawBundle | null => {
  const hit = readThirteenFMemoryCache(key);
  if (!hit) return null;
  if (isStaleHoldingsCache(hit)) {
    clearThirteenFMemoryCacheEntry(key);
    return null;
  }
  return hit;
};

const writeMemoryCache = (key: string, bundle: ThirteenFEdgarRawBundle): void => {
  writeThirteenFMemoryCache(key, bundle);
};

export { invalidateThirteenFMemoryCache } from './thirteenFMemoryCache.js';

const backfillHoldingsDeltasFromChanges = (
  bundle: ThirteenFEdgarRawBundle
): ThirteenFEdgarRawBundle => {
  if (bundleHasHoldingsDeltas(bundle) || bundle.changes.length === 0) {
    return bundle;
  }

  const byTicker = new Map(bundle.changes.map(change => [change.ticker, change]));
  let touched = false;
  const holdings = bundle.holdings.map(row => {
    const change = byTicker.get(row.ticker);
    if (!change) return row;
    touched = true;
    return {
      ...row,
      sharesDelta: change.sharesDelta,
      marketValueDeltaUsd: change.marketValueDeltaUsd,
      weightDeltaPct: change.weightDeltaPct,
    };
  });

  return touched ? { ...bundle, holdings } : bundle;
};

const enrichSummaryFormerNames = async (
  bundle: ThirteenFEdgarRawBundle
): Promise<ThirteenFEdgarRawBundle> => {
  if (bundle.summary.formerNames?.length) return bundle;
  const profile = await fetchSecCompanyProfile(bundle.summary.cik);
  if (!profile?.formerNames.length) return bundle;
  return {
    ...bundle,
    summary: {
      ...bundle.summary,
      formerNames: profile.formerNames,
    },
  };
};

const institutionNameLooksLikeCik = (name: string, cik: string): boolean => {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const normalizedName = trimmed.replace(/\D/g, '').padStart(10, '0');
  const normalizedCik = cik.replace(/\D/g, '').padStart(10, '0');
  return normalizedName === normalizedCik;
};

const enrichSummaryInstitutionName = async (
  bundle: ThirteenFEdgarRawBundle
): Promise<ThirteenFEdgarRawBundle> => {
  const currentName = bundle.summary.institutionName?.trim();
  if (currentName && !institutionNameLooksLikeCik(currentName, bundle.summary.cik)) {
    return bundle;
  }

  const profile = await fetchSecCompanyProfile(bundle.summary.cik);
  if (!profile?.name) return bundle;

  const formerNames = [...(bundle.summary.formerNames ?? profile.formerNames)];
  if (
    currentName &&
    !institutionNameLooksLikeCik(currentName, bundle.summary.cik) &&
    !formerNames.some(name => name.toLowerCase() === currentName.toLowerCase())
  ) {
    formerNames.unshift(currentName);
  }

  return {
    ...bundle,
    summary: {
      ...bundle.summary,
      institutionName: profile.name,
      formerNames: formerNames.length > 0 ? formerNames : undefined,
    },
  };
};

const prepareBundle = async (bundle: ThirteenFEdgarRawBundle): Promise<ThirteenFEdgarRawBundle> => {
  const withDeltas = backfillHoldingsDeltasFromChanges(bundle);
  const enriched = await applySectorEnrichment(withDeltas);
  const withInstitutionName = await enrichSummaryInstitutionName(enriched);
  const withFormerNames = await enrichSummaryFormerNames(withInstitutionName);
  return {
    ...withFormerNames,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
  };
};

const toSectorEnrichmentStatus = (
  cik: string,
  bundle: ThirteenFEdgarRawBundle,
  state?: SectorEnrichmentState
): ThirteenFSectorEnrichmentStatus => {
  const pendingFromBundle = countPendingSectorLookups(bundle);
  const resolved = state ?? getSectorEnrichmentState(cik, bundle.summary.quarter);
  const pendingCount =
    resolved.status === 'running'
      ? Math.max(resolved.pendingCount, pendingFromBundle)
      : pendingFromBundle;

  return {
    status:
      resolved.status === 'running'
        ? 'running'
        : pendingCount > 0
          ? 'idle'
          : 'complete',
    pendingCount,
    totalCount: Math.max(resolved.totalCount, pendingCount),
    resolvedCount: resolved.resolvedCount,
  };
};

const fetchAndPersistBundle = async (
  cik: string,
  quarter?: ThirteenFQuarterId | null
): Promise<ThirteenFEdgarRawBundle> => {
  const resolvedCik = resolveInstitutionCik(cik);
  const bundle = await fetchThirteenFBundleViaPython({
    cik: resolvedCik,
    quarter,
    maxChangesPerCategory: 50,
  });

  const prepared = await prepareBundle(bundle);
  await saveThirteenFBundleToDbCache(prepared);

  writeMemoryCache(memoryCacheKey(resolvedCik, prepared.summary.quarter), prepared);
  writeMemoryCache(memoryCacheKey(resolvedCik, quarter ?? null), prepared);

  console.info(
    `[13f] SEC bundle fetched and cached: ${prepared.summary.institutionName} ${prepared.summary.quarter} (${prepared.holdings.length} holdings)`
  );

  return prepared;
};

const getCachedBundle = async (
  cik: string,
  quarter?: ThirteenFQuarterId | null,
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFEdgarRawBundle> => {
  const resolvedCik = resolveInstitutionCik(cik);
  const key = memoryCacheKey(resolvedCik, quarter);
  const forceRefresh = options?.forceRefresh === true;

  if (forceRefresh) {
    invalidateThirteenFMemoryCache(resolvedCik, quarter);
    clearThirteenFMemoryCacheEntry(key);
    inflightFetches.delete(key);
  } else {
    const memoryHit = readMemoryCache(key);
    if (memoryHit) {
      return memoryHit;
    }

    const dbHit = await getThirteenFBundleFromDbCache(resolvedCik, quarter);
    if (dbHit && !isStaleHoldingsCache(dbHit)) {
      const prepared = await prepareBundle(dbHit);
      if ((dbHit.schemaVersion ?? 0) < BUNDLE_SCHEMA_VERSION) {
        await saveThirteenFBundleToDbCache(prepared);
      }
      writeMemoryCache(key, prepared);
      writeMemoryCache(memoryCacheKey(resolvedCik, prepared.summary.quarter), prepared);
      return prepared;
    }

    if (dbHit && isStaleHoldingsCache(dbHit)) {
      const backfilled = backfillHoldingsDeltasFromChanges(dbHit);
      if (!isStaleHoldingsCache(backfilled)) {
        const prepared = await prepareBundle(backfilled);
        await saveThirteenFBundleToDbCache(prepared);
        writeMemoryCache(key, prepared);
        writeMemoryCache(memoryCacheKey(resolvedCik, prepared.summary.quarter), prepared);
        console.info(
          `[13f] upgraded stale cache without SEC refetch: ${prepared.summary.cik} ${prepared.summary.quarter}`
        );
        return prepared;
      }
      console.info(
        `[13f] stale cache — refetching from SEC: ${dbHit.summary.cik} ${dbHit.summary.quarter}`
      );
    }
  }

  let promise = inflightFetches.get(key);
  if (!promise) {
    promise = fetchAndPersistBundle(resolvedCik, quarter).finally(() => {
      inflightFetches.delete(key);
    });
    inflightFetches.set(key, promise);
  }
  return promise;
};

const sortHoldings = (
  holdings: ThirteenFEdgarRawBundle['holdings'],
  sortBy: ThirteenFHoldingSortField,
  sortDir: ThirteenFSortDirection,
  totalMarketValueUsd: number
) => sortHoldingsRows(holdings, sortBy, sortDir, totalMarketValueUsd);

export const isThirteenFLiveDataEnabled = (): boolean => isThirteenFEdgarConfigured();

export const getThirteenFCacheStatus = () => ({
  dbCachePolicy: 'permanent' as const,
  manualRefreshOnly: isThirteenFCacheManualRefreshOnly(),
  memoryCacheTtlMinutes: getThirteenFMemoryCacheTtlMinutes(),
  bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
  historicalQuartersPermanent: isThirteenFHistoricalQuarterPermanent(),
});

export const getHoldingsFromEdgar = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null,
  sortBy: ThirteenFHoldingSortField = 'portfolioWeight',
  sortDir: ThirteenFSortDirection = 'desc',
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFHoldingsResponse> => {
  const bundle = await getCachedBundle(cik, quarterInput, options);
  const sorted = sortHoldings(
    bundle.holdings,
    sortBy,
    sortDir,
    bundle.summary.totalMarketValueUsd
  );

  const enrichmentState = scheduleBackgroundSectorEnrichment(cik, bundle);
  const cacheMeta = await getThirteenFBundleCacheMeta(cik, bundle.summary.quarter);

  return {
    summary: bundle.summary,
    holdings: sorted,
    distribution: bundle.distribution,
    availableQuarters: bundle.availableQuarters,
    sectorEnrichment: toSectorEnrichmentStatus(cik, bundle, enrichmentState),
    cacheFetchedAt: cacheMeta?.fetchedAt,
  };
};

export const getSectorEnrichmentStatusForInstitution = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null
): Promise<ThirteenFSectorEnrichmentStatus> => {
  const bundle = await getCachedBundle(cik, quarterInput);
  return toSectorEnrichmentStatus(cik, bundle, getSectorEnrichmentState(cik, bundle.summary.quarter));
};

export const getChangesFromEdgar = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null,
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFPositionChangesResponse> => {
  const bundle = await getCachedBundle(cik, quarterInput, options);
  const displayedCounts =
    bundle.displayedCounts ?? computeChangeCounts(bundle.changes);
  const totalCounts = bundle.totalCounts ?? bundle.counts ?? displayedCounts;
  return {
    cik: bundle.summary.cik,
    institutionName: bundle.summary.institutionName,
    quarter: bundle.summary.quarter,
    priorQuarter: bundle.priorQuarter,
    filingDate: bundle.summary.filingDate,
    reportDate: bundle.summary.reportDate,
    changes: bundle.changes,
    counts: displayedCounts,
    totalCounts,
    displayedCounts,
    changesLimitPerCategory: bundle.changesLimitPerCategory ?? 50,
    availableQuarters: bundle.availableQuarters,
  };
};
