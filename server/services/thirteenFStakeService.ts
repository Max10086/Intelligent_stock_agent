import type { ThirteenFStakeFeedResponse } from '../../types/thirteenF.js';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { fetchStakeFeedFromSec } from '../lib/secStakeFeedClient.js';
import { isStakeTrackerConfigured } from '../lib/stakeTrackerClient.js';

const CACHE_TTL_MS = 15 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const CACHE_SCHEMA_VERSION = 5;

type CacheEntry = {
  expiresAt: number;
  schemaVersion: number;
  payload: ThirteenFStakeFeedResponse;
};

const feedCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ThirteenFStakeFeedResponse>>();

const cacheKey = (
  ciks: string[],
  limit: number,
  limitPerInstitution: number,
  sinceDate: string | null
): string => {
  const normalized = [...new Set(ciks.map(resolveInstitutionCik))].sort().join(',');
  return `${normalized}::${limit}::${limitPerInstitution}::${sinceDate ?? 'all'}`;
};

export const isImportantTrackingEnabled = (): boolean => isStakeTrackerConfigured();

export const getStakeFeed = async (params: {
  ciks: string[];
  limit?: number;
  limitPerInstitution?: number;
  sinceDate?: string | null;
  lookbackDays?: number | null;
  forceRefresh?: boolean;
}): Promise<ThirteenFStakeFeedResponse> => {
  const ciks = [...new Set(params.ciks.map(resolveInstitutionCik).filter(Boolean))];
  const sinceDate = params.sinceDate ?? null;

  if (ciks.length === 0) {
    return {
      filings: [],
      totalCount: 0,
      institutionCount: 0,
      fetchedAt: new Date().toISOString(),
      dataSource: 'sec-edgar-submissions',
      sinceDate,
      lookbackDays: params.lookbackDays ?? null,
    };
  }

  const limit = Math.max(1, Math.min(params.limit ?? 100, 200));
  const limitPerInstitution = Math.max(1, Math.min(params.limitPerInstitution ?? 20, 40));
  const key = cacheKey(ciks, limit, limitPerInstitution, sinceDate);

  if (!params.forceRefresh) {
    const hit = feedCache.get(key);
    if (hit && hit.expiresAt > Date.now() && hit.schemaVersion === CACHE_SCHEMA_VERSION) {
      return hit.payload;
    }
  } else {
    feedCache.delete(key);
    inflight.delete(key);
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchStakeFeedFromSec({
      ciks,
      limit,
      limitPerInstitution,
      sinceDate,
      lookbackDays: params.lookbackDays ?? null,
    }).then(payload => {
      const ttl = payload.filings.length > 0 ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
      feedCache.set(key, {
        expiresAt: Date.now() + ttl,
        schemaVersion: CACHE_SCHEMA_VERSION,
        payload,
      });
      inflight.delete(key);
      return payload;
    });
    inflight.set(key, promise);
  }

  return promise;
};

export const invalidateStakeFeedCache = (): void => {
  feedCache.clear();
  inflight.clear();
};
