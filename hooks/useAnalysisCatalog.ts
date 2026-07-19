import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/authenticatedFetch.ts';
import {
  CATALOG_DISPLAY_CATEGORIES,
  classifyConclusion,
  type ConclusionCategory,
} from '../utils/conclusionCategory.ts';

export interface AnalysisCatalogItem {
  id: string;
  ticker: string;
  companyName: string | null;
  overallConclusion: string | null;
  currentPrice: string | null;
  currency: string | null;
  exchange: string | null;
  completedAt: string | null;
  category: ConclusionCategory;
}

interface CatalogPageResponse {
  items: AnalysisCatalogItem[];
  total?: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface AnalysisCatalogCacheSnapshot {
  userId: string;
  items: AnalysisCatalogItem[];
  total: number | null;
  hasMore: boolean;
  offset: number;
  fetchedAt: number;
}

export const CATALOG_PAGE_SIZE = 60;

const CACHE_KEY_PREFIX = 'intelligent-stock-agent:analysis-catalog-v1';

let memoryCache: AnalysisCatalogCacheSnapshot | null = null;

const cacheStorageKey = (userId: string) => `${CACHE_KEY_PREFIX}:${userId}`;

const readSessionCache = (userId: string): AnalysisCatalogCacheSnapshot | null => {
  try {
    const raw = sessionStorage.getItem(cacheStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisCatalogCacheSnapshot;
    if (parsed.userId !== userId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeSessionCache = (snapshot: AnalysisCatalogCacheSnapshot) => {
  try {
    sessionStorage.setItem(cacheStorageKey(snapshot.userId), JSON.stringify(snapshot));
  } catch {
    // ignore quota / private mode
  }
};

const readCacheForUser = (userId: string): AnalysisCatalogCacheSnapshot | null => {
  if (memoryCache?.userId === userId) return memoryCache;
  const fromSession = readSessionCache(userId);
  if (fromSession) {
    memoryCache = fromSession;
    return fromSession;
  }
  return null;
};

const persistCache = (snapshot: AnalysisCatalogCacheSnapshot) => {
  memoryCache = snapshot;
  writeSessionCache(snapshot);
};

export const invalidateAnalysisCatalogCache = (userId?: string | null) => {
  if (userId) {
    memoryCache = memoryCache?.userId === userId ? null : memoryCache;
    try {
      sessionStorage.removeItem(cacheStorageKey(userId));
    } catch {
      // ignore
    }
    return;
  }
  memoryCache = null;
};

export function useAnalysisCatalog(userId?: string | null) {
  const cachedInitial = userId ? readCacheForUser(userId) : null;

  const [items, setItems] = useState<AnalysisCatalogItem[]>(() => cachedInitial?.items ?? []);
  const [total, setTotal] = useState<number | null>(() => cachedInitial?.total ?? null);
  const [hasMore, setHasMore] = useState(() => cachedInitial?.hasMore ?? false);
  const [loadingInitial, setLoadingInitial] = useState(() => !cachedInitial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(cachedInitial?.offset ?? 0);
  const totalRef = useRef<number | null>(cachedInitial?.total ?? null);
  const backgroundLoadingRef = useRef(false);
  const mountedRef = useRef(true);
  const userIdRef = useRef(userId ?? null);
  userIdRef.current = userId ?? null;
  totalRef.current = total;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const saveCache = useCallback(
    (next: {
      items: AnalysisCatalogItem[];
      total: number | null;
      hasMore: boolean;
      offset: number;
    }) => {
      const uid = userIdRef.current;
      if (!uid) return;
      persistCache({
        userId: uid,
        items: next.items,
        total: next.total,
        hasMore: next.hasMore,
        offset: next.offset,
        fetchedAt: Date.now(),
      });
    },
    []
  );

  const fetchPage = useCallback(
    async (offset: number, includeTotal: boolean): Promise<CatalogPageResponse> => {
      const params = new URLSearchParams({
        limit: String(CATALOG_PAGE_SIZE),
        offset: String(offset),
      });
      if (includeTotal) {
        params.set('includeTotal', 'true');
      }

      const response = await apiFetch(`/api/jobs/catalog?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to load catalog (${response.status})`);
      }

      const data = await response.json();
      return {
        items: Array.isArray(data.items) ? data.items : [],
        total: typeof data.total === 'number' ? data.total : undefined,
        hasMore: Boolean(data.hasMore),
        limit: typeof data.limit === 'number' ? data.limit : CATALOG_PAGE_SIZE,
        offset: typeof data.offset === 'number' ? data.offset : offset,
      };
    },
    []
  );

  const loadMorePages = useCallback(async () => {
    if (backgroundLoadingRef.current) return;
    backgroundLoadingRef.current = true;
    if (mountedRef.current) {
      setLoadingMore(true);
    }

    try {
      let keepLoading = true;
      while (keepLoading && mountedRef.current) {
        const page = await fetchPage(offsetRef.current, false);
        if (page.items.length === 0) {
          keepLoading = false;
          if (mountedRef.current) {
            setHasMore(false);
            setItems(prev => {
              saveCache({
                items: prev,
                total: totalRef.current,
                hasMore: false,
                offset: offsetRef.current,
              });
              return prev;
            });
          }
          break;
        }

        offsetRef.current += page.items.length;
        if (mountedRef.current) {
          setItems(prev => {
            const seen = new Set(prev.map(item => item.id));
            const merged = [...prev];
            for (const item of page.items) {
              if (!seen.has(item.id)) {
                merged.push(item);
                seen.add(item.id);
              }
            }
            saveCache({
              items: merged,
              total: totalRef.current,
              hasMore: page.hasMore,
              offset: offsetRef.current,
            });
            return merged;
          });
          setHasMore(page.hasMore);
        }

        keepLoading = page.hasMore;
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load catalog');
      }
    } finally {
      backgroundLoadingRef.current = false;
      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [fetchPage, saveCache]);

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      const uid = userIdRef.current;
      if (!uid) return;

      if (!options?.force) {
        const cached = readCacheForUser(uid);
        if (cached) {
          setItems(cached.items);
          setTotal(cached.total);
          setHasMore(cached.hasMore);
          offsetRef.current = cached.offset;
          setLoadingInitial(false);
          setError(null);
          if (cached.hasMore) {
            void loadMorePages();
          }
          return;
        }
      }

      invalidateAnalysisCatalogCache(uid);
      setLoadingInitial(true);
      setError(null);
      setItems([]);
      setTotal(null);
      setHasMore(false);
      offsetRef.current = 0;
      backgroundLoadingRef.current = false;

      try {
        const firstPage = await fetchPage(0, true);
        if (!mountedRef.current) return;

        const nextTotal = firstPage.total ?? null;
        totalRef.current = nextTotal;
        setItems(firstPage.items);
        setTotal(nextTotal);
        setHasMore(firstPage.hasMore);
        offsetRef.current = firstPage.items.length;
        setLoadingInitial(false);
        saveCache({
          items: firstPage.items,
          total: nextTotal,
          hasMore: firstPage.hasMore,
          offset: offsetRef.current,
        });

        if (firstPage.hasMore) {
          void loadMorePages();
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load catalog');
        setLoadingInitial(false);
      }
    },
    [fetchPage, loadMorePages, saveCache]
  );

  const loadMorePagesRef = useRef(loadMorePages);
  loadMorePagesRef.current = loadMorePages;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!userId) {
      setLoadingInitial(false);
      return;
    }

    const cached = readCacheForUser(userId);
    if (cached) {
      totalRef.current = cached.total;
      setItems(cached.items);
      setTotal(cached.total);
      setHasMore(cached.hasMore);
      offsetRef.current = cached.offset;
      setLoadingInitial(false);
      setError(null);
      if (cached.hasMore && !backgroundLoadingRef.current) {
        void loadMorePagesRef.current();
      }
      return;
    }

    void refreshRef.current({ force: true });
  }, [userId]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<ConclusionCategory, AnalysisCatalogItem[]> = {
      strong_buy: [],
      buy: [],
      overweight: [],
      hold: [],
      sell: [],
      other: [],
    };

    for (const item of items) {
      groups[classifyConclusion(item.overallConclusion)].push(item);
    }

    for (const category of Object.keys(groups) as ConclusionCategory[]) {
      groups[category].sort(
        (a, b) =>
          new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime()
      );
    }

    return groups;
  }, [items]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ConclusionCategory, number> = {
      strong_buy: 0,
      buy: 0,
      overweight: 0,
      hold: 0,
      sell: 0,
      other: 0,
    };
    for (const item of items) {
      counts[classifyConclusion(item.overallConclusion)] += 1;
    }
    return counts;
  }, [items]);

  const defaultCategory = useMemo((): ConclusionCategory => {
    for (const category of CATALOG_DISPLAY_CATEGORIES) {
      if (categoryCounts[category] > 0) return category;
    }
    return 'strong_buy';
  }, [categoryCounts]);

  const forceRefresh = useCallback(() => refresh({ force: true }), [refresh]);

  return {
    items,
    total,
    hasMore,
    loading: loadingInitial,
    loadingInitial,
    loadingMore,
    error,
    groupedByCategory,
    categoryCounts,
    defaultCategory,
    refresh: forceRefresh,
  };
}
