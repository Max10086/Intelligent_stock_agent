import type {
  ThirteenFPerformanceSortMode,
  ThirteenFPerformanceTrackingResponse,
  ThirteenFQuarterId,
} from '../../types/thirteenF.js';

type PerformanceCacheRecord = {
  cachedDate: string;
  data: ThirteenFPerformanceTrackingResponse;
};

const cache = new Map<string, PerformanceCacheRecord>();

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

export const buildPerformanceCacheKey = (
  ciks: string[],
  quarter: ThirteenFQuarterId | null | undefined,
  sortMode: ThirteenFPerformanceSortMode
): string => {
  const normalized = [...new Set(ciks.map(cik => cik.trim()).filter(Boolean))].sort().join('|');
  return `${todayIsoDate()}|${normalized}|${quarter ?? 'latest'}|${sortMode}`;
};

export const readDailyPerformanceCache = (
  key: string
): ThirteenFPerformanceTrackingResponse | null => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.cachedDate !== todayIsoDate()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
};

export const writeDailyPerformanceCache = (
  key: string,
  data: ThirteenFPerformanceTrackingResponse
): void => {
  cache.set(key, { cachedDate: todayIsoDate(), data });
};

export const clearDailyPerformanceCache = (key?: string): void => {
  if (key) {
    cache.delete(key);
    return;
  }
  cache.clear();
};
