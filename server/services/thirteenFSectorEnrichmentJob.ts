import type { ThirteenFQuarterId } from '../../types/thirteenF.js';
import type { ThirteenFEdgarRawBundle } from '../lib/thirteenFEdgarClient.js';
import { saveThirteenFBundleToDbCache } from './thirteenFCacheService.js';
import {
  applyDbSectorEnrichment,
  applyStaticSectorEnrichment,
  collectUnmappedSectorRequests,
  type SectorLookupRequest,
} from './thirteenFSectorEnrichment.js';
import { isSectorLlmEnabled, lookupSectorsViaLlm } from './thirteenFSectorLlmService.js';
import { invalidateThirteenFMemoryCache } from './thirteenFMemoryCache.js';

export type SectorEnrichmentStatus = 'idle' | 'running' | 'complete';

export interface SectorEnrichmentState {
  status: SectorEnrichmentStatus;
  pendingCount: number;
  totalCount: number;
  resolvedCount: number;
}

const jobState = new Map<string, SectorEnrichmentState>();
const inflightJobs = new Map<string, Promise<void>>();
const inflightTickers = new Set<string>();

const jobKey = (cik: string, quarter: ThirteenFQuarterId): string => `${cik}:${quarter}`;

export const getSectorEnrichmentState = (
  cik: string,
  quarter: ThirteenFQuarterId
): SectorEnrichmentState => {
  return (
    jobState.get(jobKey(cik, quarter)) ?? {
      status: 'idle',
      pendingCount: 0,
      totalCount: 0,
      resolvedCount: 0,
    }
  );
};

const setJobState = (cik: string, quarter: ThirteenFQuarterId, state: SectorEnrichmentState) => {
  jobState.set(jobKey(cik, quarter), state);
};

const runBackgroundSectorEnrichment = async (
  cik: string,
  quarter: ThirteenFQuarterId,
  bundle: ThirteenFEdgarRawBundle,
  pending: SectorLookupRequest[]
): Promise<void> => {
  const key = jobKey(cik, quarter);
  const totalCount = pending.length;

  setJobState(cik, quarter, {
    status: 'running',
    pendingCount: totalCount,
    totalCount,
    resolvedCount: 0,
  });

  const toLookup = pending.filter(row => {
    const ticker = row.ticker.toUpperCase();
    if (inflightTickers.has(ticker)) return false;
    inflightTickers.add(ticker);
    return true;
  });

  try {
    const results = await lookupSectorsViaLlm(toLookup);
    const resolvedCount = results.length;

    const withDb = await applyDbSectorEnrichment(
      applyStaticSectorEnrichment(bundle)
    );

    await saveThirteenFBundleToDbCache(withDb);
    invalidateThirteenFMemoryCache(cik, quarter);

    setJobState(cik, quarter, {
      status: 'complete',
      pendingCount: 0,
      totalCount,
      resolvedCount,
    });
  } catch (error) {
    console.warn(
      `[13f-sector] background enrichment failed for ${cik} ${quarter}:`,
      error instanceof Error ? error.message : error
    );
    setJobState(cik, quarter, {
      status: 'complete',
      pendingCount: 0,
      totalCount,
      resolvedCount: 0,
    });
  } finally {
    for (const row of toLookup) {
      inflightTickers.delete(row.ticker.toUpperCase());
    }
    inflightJobs.delete(key);
  }
};

export const scheduleBackgroundSectorEnrichment = (
  cik: string,
  bundle: ThirteenFEdgarRawBundle
): SectorEnrichmentState => {
  const quarter = bundle.summary.quarter;

  if (!isSectorLlmEnabled()) {
    return getSectorEnrichmentState(cik, quarter);
  }

  const pending = collectUnmappedSectorRequests(bundle);
  if (pending.length === 0) {
    setJobState(cik, quarter, {
      status: 'complete',
      pendingCount: 0,
      totalCount: 0,
      resolvedCount: 0,
    });
    return getSectorEnrichmentState(cik, quarter);
  }

  const key = jobKey(cik, quarter);
  const existing = inflightJobs.get(key);
  if (existing) {
    return getSectorEnrichmentState(cik, quarter);
  }

  setJobState(cik, quarter, {
    status: 'running',
    pendingCount: pending.length,
    totalCount: pending.length,
    resolvedCount: 0,
  });

  const promise = runBackgroundSectorEnrichment(cik, quarter, bundle, pending).catch(() => {
    // errors logged inside
  });
  inflightJobs.set(key, promise);

  return getSectorEnrichmentState(cik, quarter);
};
