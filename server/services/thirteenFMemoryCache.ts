import type { ThirteenFQuarterId } from '../../types/thirteenF.js';
import type { ThirteenFEdgarRawBundle } from '../lib/thirteenFEdgarClient.js';

/** Short-lived in-process cache to avoid repeated JSON parse from Postgres. */
const MEMORY_CACHE_TTL_MS = 2 * 60 * 1000;
const memoryCache = new Map<string, { expiresAt: number; bundle: ThirteenFEdgarRawBundle }>();

export const memoryCacheKey = (cik: string, quarter?: ThirteenFQuarterId | null): string =>
  `${cik}:${quarter ?? 'latest'}`;

export const readThirteenFMemoryCache = (key: string): ThirteenFEdgarRawBundle | null => {
  const hit = memoryCache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) memoryCache.delete(key);
    return null;
  }
  return hit.bundle;
};

export const writeThirteenFMemoryCache = (key: string, bundle: ThirteenFEdgarRawBundle): void => {
  memoryCache.set(key, {
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    bundle,
  });
};

export const invalidateThirteenFMemoryCache = (
  cik: string,
  quarter?: ThirteenFQuarterId | null
): void => {
  memoryCache.delete(memoryCacheKey(cik, quarter ?? null));
  if (quarter) {
    memoryCache.delete(memoryCacheKey(cik, null));
  }
};

export const getThirteenFMemoryCacheTtlMinutes = (): number => MEMORY_CACHE_TTL_MS / (60 * 1000);

export const clearThirteenFMemoryCacheEntry = (key: string): void => {
  memoryCache.delete(key);
};
