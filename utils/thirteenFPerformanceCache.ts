import type {
  ThirteenFPerformanceEntry,
  ThirteenFPerformanceSortMode,
  ThirteenFPerformanceTrackingResponse,
  ThirteenFQuarterId,
} from '../types/thirteenF.ts';

const STORAGE_KEY = 'thirteen_f_performance_cache_v4';

export type PerformanceCacheRecord = {
  cacheKey: string;
  cachedDate: string;
  fetchedAt: string;
  data: ThirteenFPerformanceTrackingResponse;
};

export const sortPerformanceEntries = (
  entries: ThirteenFPerformanceEntry[],
  sortMode: ThirteenFPerformanceSortMode
): ThirteenFPerformanceEntry[] => {
  if (sortMode === 'by_return_pct') {
    return [...entries].sort(
      (a, b) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity)
    );
  }
  return [...entries].sort(
    (a, b) => b.totalMarketValueDeltaUsd - a.totalMarketValueDeltaUsd
  );
};

export const buildPerformanceCacheKey = (
  ciks: string[],
  quarter: ThirteenFQuarterId | null
): string => {
  const normalized = [...new Set(ciks.map(cik => cik.trim()).filter(Boolean))].sort().join('|');
  return `${normalized}::${quarter ?? 'latest'}`;
};

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

export const readPerformanceCache = (cacheKey: string): PerformanceCacheRecord | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerformanceCacheRecord;
    if (!parsed?.cacheKey || !parsed?.cachedDate || !parsed?.data) {
      return null;
    }
    if (parsed.cachedDate !== todayIsoDate()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (parsed.cacheKey !== cacheKey) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writePerformanceCache = (
  cacheKey: string,
  data: ThirteenFPerformanceTrackingResponse
): PerformanceCacheRecord => {
  const record: PerformanceCacheRecord = {
    cacheKey,
    cachedDate: todayIsoDate(),
    fetchedAt: new Date().toISOString(),
    data,
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  return record;
};

export const clearPerformanceCache = (): void => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
};
