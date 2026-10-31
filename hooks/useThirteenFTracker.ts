import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../types.ts';
import type {
  ThirteenFAggregateDashboardResponse,
  ThirteenFHoldingSortField,
  ThirteenFHoldingsResponse,
  ThirteenFInstitution,
  ThirteenFPerformanceSortMode,
  ThirteenFPerformanceQuoteEnrichment,
  ThirteenFPerformanceTrackingResponse,
  ThirteenFPositionChangeCategory,
  ThirteenFPositionChangesResponse,
  ThirteenFQuarterId,
  ThirteenFSectorEnrichmentStatus,
  ThirteenFSortDirection,
  ThirteenFStakeFeedResponse,
  ThirteenFStakeBackfillResponse,
  ThirteenFStakeFiling,
  ThirteenFStakeLookbackDays,
  ThirteenFStakeParseResponse,
  ThirteenFTrackerPanel,
  ThirteenFUserTrackerState,
  ThirteenFWatchlistItem,
} from '../types/thirteenF.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';
import {
  institutionSearchMinQueryLength,
  normalizeInstitutionCik,
  resolveInstitutionCik,
} from '../utils/thirteenFInstitutionSearch.ts';
import {
  buildPerformanceCacheKey,
  clearPerformanceCache,
  readPerformanceCache,
  sortPerformanceEntries,
  writePerformanceCache,
} from '../utils/thirteenFPerformanceCache.ts';
import { clampConsensusMinInstitutionCount } from '../utils/thirteenFConsensus.ts';
import { mergeSameDayStakeFilings } from '../utils/thirteenFStakeMerge.ts';
import {
  computeStakeSinceDate,
  parseStakeLookbackDays,
} from '../utils/thirteenFStakeLookback.ts';

const WATCHLIST_STORAGE_KEY = 'thirteen_f_watchlist_v2';
const STARRED_STORAGE_KEY = 'thirteen_f_starred_v1';
const STAKE_CIKS_STORAGE_KEY = 'thirteen_f_stake_ciks_v1';
const STAKE_LOOKBACK_STORAGE_KEY = 'thirteen_f_stake_lookback_v1';
const DEFAULT_CIK = '0001350694';
const PERFORMANCE_QUOTE_BATCH = 12;

const migrateWatchlistItem = (item: ThirteenFWatchlistItem): ThirteenFWatchlistItem => {
  const cik = resolveInstitutionCik(item.cik);
  const name = item.name ?? '';

  if (cik === '0001649339' && /ark|cathie/i.test(name)) {
    return { ...item, cik: '0001697748', name: 'ARK Invest' };
  }
  if (cik === '0001420793' || (cik === '0001649339' && /scion|burry/i.test(name))) {
    return { ...item, cik: '0001649339', name: 'Scion' };
  }
  if (cik === '0001277006') {
    return {
      ...item,
      cik: '0001512920',
      name: /^\d{10}$/.test(name.replace(/\D/g, '')) || !name.trim() ? 'Sprott Inc.' : name,
    };
  }

  return { ...item, cik };
};

const readWatchlist = (): ThirteenFWatchlistItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw =
      window.localStorage.getItem(WATCHLIST_STORAGE_KEY) ??
      window.localStorage.getItem('thirteen_f_watchlist_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ThirteenFWatchlistItem[];
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map(migrateWatchlistItem);
    const deduped = new Map<string, ThirteenFWatchlistItem>();
    for (const item of migrated) {
      const key = resolveInstitutionCik(item.cik);
      if (!deduped.has(key)) {
        deduped.set(key, { ...item, cik: key });
      }
    }
    return [...deduped.values()];
  } catch {
    return [];
  }
};

const writeWatchlist = (items: ThirteenFWatchlistItem[]) => {
  window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
};

const migrateStarredCik = (cik: string): string => resolveInstitutionCik(cik);

const readStarredCiks = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STARRED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(migrateStarredCik).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeStarredCiks = (ciks: Set<string>) => {
  window.localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify([...ciks]));
};

const readStakeCiks = (
  watchlist: ThirteenFWatchlistItem[],
  starred: Set<string>
): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STAKE_CIKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      const watchlistNorm = new Set(watchlist.map(item => resolveInstitutionCik(item.cik)));
      const filtered = parsed.map(resolveInstitutionCik).filter(cik => watchlistNorm.has(cik));
      if (filtered.length > 0) return new Set(filtered);
    }
  } catch {
    // ignore corrupt storage
  }

  const starredInWatchlist = watchlist
    .map(item => resolveInstitutionCik(item.cik))
    .filter(cik => starred.has(cik));
  return starredInWatchlist.length > 0 ? new Set(starredInWatchlist) : new Set();
};

const writeStakeCiks = (ciks: Set<string>): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STAKE_CIKS_STORAGE_KEY, JSON.stringify([...ciks]));
};

const readStakeLookback = (): ThirteenFStakeLookbackDays => {
  if (typeof window === 'undefined') return 180;
  try {
    const raw = window.localStorage.getItem(STAKE_LOOKBACK_STORAGE_KEY);
    if (raw != null) return parseStakeLookbackDays(Number(raw));
  } catch {
    // ignore corrupt storage
  }
  return 180;
};

const buildWatchlistFromPresets = (presets: ThirteenFInstitution[]): ThirteenFWatchlistItem[] =>
  presets.map((inst, index) => ({
    cik: resolveInstitutionCik(inst.cik),
    name: inst.shortName ?? inst.name,
    addedAt: new Date().toISOString(),
    sortOrder: index,
  }));

const readLocalTrackerState = (): ThirteenFUserTrackerState => {
  const watchlist = readWatchlist();
  const starredCiks = [...readStarredCiks()];
  return {
    watchlist,
    starredCiks,
    stakeCiks: [...readStakeCiks(watchlist, readStarredCiks())],
    stakeLookbackDays: readStakeLookback(),
  };
};

const unwrapData = <T,>(payload: unknown): T => {
  const body = payload as { ok?: boolean; data?: T; error?: string };
  if (body?.ok === false) {
    throw new Error(body.error || 'Request failed');
  }
  if (body?.data !== undefined) return body.data;
  return payload as T;
};

type InstitutionCacheEntry = {
  quarter: ThirteenFQuarterId;
  holdings: ThirteenFHoldingsResponse;
  changes: ThirteenFPositionChangesResponse;
  sectorEnrichment: ThirteenFSectorEnrichmentStatus | null;
  sortField: ThirteenFHoldingSortField;
  sortDir: ThirteenFSortDirection;
};

const institutionCacheKey = (cik: string, quarter: ThirteenFQuarterId | null) =>
  `${normalizeInstitutionCik(cik)}::${quarter ?? 'latest'}`;

const institutionDataMatchesRequest = (
  requestCik: string,
  requestQuarter: ThirteenFQuarterId | null,
  holdings: ThirteenFHoldingsResponse | null,
  changes: ThirteenFPositionChangesResponse | null
): boolean => {
  if (!holdings || !changes) return false;
  const norm = normalizeInstitutionCik(requestCik);
  if (normalizeInstitutionCik(holdings.summary.cik) !== norm) return false;
  if (normalizeInstitutionCik(changes.cik) !== norm) return false;
  const quarter = requestQuarter ?? holdings.summary.quarter;
  return holdings.summary.quarter === quarter && changes.quarter === quarter;
};

export const useThirteenFTracker = (language: Language, enabled: boolean) => {
  const [watchlist, setWatchlist] = useState<ThirteenFWatchlistItem[]>(() => readWatchlist());
  const [starredCiks, setStarredCiks] = useState<Set<string>>(() => readStarredCiks());
  const [presets, setPresets] = useState<ThirteenFInstitution[]>([]);
  const [selectedCik, setSelectedCik] = useState<string>(
    () => readWatchlist()[0]?.cik ?? DEFAULT_CIK
  );
  const [selectedQuarter, setSelectedQuarter] = useState<ThirteenFQuarterId | null>(null);
  const [holdingsSort, setHoldingsSort] = useState<{
    field: ThirteenFHoldingSortField;
    dir: ThirteenFSortDirection;
  }>({ field: 'portfolioWeight', dir: 'desc' });
  const [changeFilter, setChangeFilter] = useState<ThirteenFPositionChangeCategory | 'ALL'>(
    'ALL'
  );
  const [highlightTicker, setHighlightTicker] = useState<string | null>(null);
  const [aggregateCiks, setAggregateCiks] = useState<Set<string>>(() => new Set());
  const [aggregateMinInstitutionCount, setAggregateMinInstitutionCountState] = useState(2);
  const [performanceCik, setPerformanceCik] = useState<string | null>(null);
  const [performanceSortMode, setPerformanceSortMode] =
    useState<ThirteenFPerformanceSortMode>('by_position_delta');
  const [activePanel, setActivePanel] = useState<ThirteenFTrackerPanel>('institution');

  const [holdings, setHoldings] = useState<ThirteenFHoldingsResponse | null>(null);
  const [changes, setChanges] = useState<ThirteenFPositionChangesResponse | null>(null);
  const [aggregate, setAggregate] = useState<ThirteenFAggregateDashboardResponse | null>(null);
  const [performance, setPerformance] = useState<ThirteenFPerformanceTrackingResponse | null>(
    null
  );

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sectorEnrichment, setSectorEnrichment] = useState<ThirteenFSectorEnrichmentStatus | null>(
    null
  );
  const [aggregateLoading, setAggregateLoading] = useState(false);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceEnriching, setPerformanceEnriching] = useState(false);
  const [performanceQuoteProgress, setPerformanceQuoteProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [performanceCacheFetchedAt, setPerformanceCacheFetchedAt] = useState<string | null>(null);
  const [stakeFeed, setStakeFeed] = useState<ThirteenFStakeFeedResponse | null>(null);
  const [stakeFeedLoading, setStakeFeedLoading] = useState(false);
  const [stakeFeedError, setStakeFeedError] = useState<string | null>(null);
  const [stakeEnrichments, setStakeEnrichments] = useState<
    Record<string, ThirteenFStakeParseResponse['enrichments'][number]>
  >({});
  const [stakeOwnershipLoading, setStakeOwnershipLoading] = useState(false);
  const stakeEnrichRequestRef = useRef(0);
  const [stakeChangeLoadingIds, setStakeChangeLoadingIds] = useState<Set<string>>(() => new Set());
  const [stakeCiks, setStakeCiks] = useState<Set<string>>(() =>
    readStakeCiks(readWatchlist(), readStarredCiks())
  );
  const [stakeLookbackDays, setStakeLookbackDaysState] = useState<ThirteenFStakeLookbackDays>(
    () => readStakeLookback()
  );
  const performanceLoadIdRef = useRef(0);
  const performanceSortModeRef = useRef(performanceSortMode);
  const [error, setError] = useState<string | null>(null);
  const [institutionSearchQuery, setInstitutionSearchQuery] = useState('');
  const [institutionSearchResults, setInstitutionSearchResults] = useState<
    ThirteenFInstitution[]
  >([]);
  const [institutionSearchLoading, setInstitutionSearchLoading] = useState(false);
  const loadRequestIdRef = useRef(0);
  const selectedCikRef = useRef(selectedCik);
  const selectedQuarterRef = useRef(selectedQuarter);
  const holdingsRef = useRef(holdings);
  const changesRef = useRef(changes);
  const institutionCacheRef = useRef(new Map<string, InstitutionCacheEntry>());
  const lastLoadedSortRef = useRef({
    field: holdingsSort.field,
    dir: holdingsSort.dir,
  });
  const [userStateReady, setUserStateReady] = useState(false);
  const skipPersistUserStateRef = useRef(true);

  useEffect(() => {
    writeStakeCiks(stakeCiks);
  }, [stakeCiks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STAKE_LOOKBACK_STORAGE_KEY, String(stakeLookbackDays));
  }, [stakeLookbackDays]);

  useEffect(() => {
    const watchlistNorm = new Set(watchlist.map(item => resolveInstitutionCik(item.cik)));
    setStakeCiks(prev => {
      const next = new Set([...prev].filter(cik => watchlistNorm.has(cik)));
      if (next.size === prev.size && [...next].every(cik => prev.has(cik))) return prev;
      return next;
    });
  }, [watchlist]);

  useEffect(() => {
    selectedCikRef.current = selectedCik;
  }, [selectedCik]);

  useEffect(() => {
    if (aggregateCiks.size > 0) return;
    setAggregate(null);
  }, [aggregateCiks]);

  useEffect(() => {
    if (performanceCik) return;
    setPerformance(null);
    setPerformanceCacheFetchedAt(null);
  }, [performanceCik]);

  useEffect(() => {
    selectedQuarterRef.current = selectedQuarter;
  }, [selectedQuarter]);

  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);

  useEffect(() => {
    changesRef.current = changes;
  }, [changes]);

  useEffect(() => {
    writeWatchlist(watchlist);
  }, [watchlist]);

  useEffect(() => {
    writeStarredCiks(starredCiks);
  }, [starredCiks]);

  useEffect(() => {
    const watchlistCikSet = new Set(watchlist.map(item => resolveInstitutionCik(item.cik)));
    setStarredCiks(prev => {
      const next = new Set([...prev].filter(cik => watchlistCikSet.has(cik)));
      return next.size === prev.size ? prev : next;
    });
  }, [watchlist]);

  const loadPresets = useCallback(async () => {
    const response = await apiFetch('/api/13f/presets');
    if (!response.ok) throw new Error(await readApiError(response));
    const payload = unwrapData<{ presets: ThirteenFInstitution[] }>(await response.json());
    setPresets(payload.presets ?? []);
  }, []);

  const clearInstitutionData = useCallback(() => {
    setHoldings(null);
    setChanges(null);
    setSectorEnrichment(null);
    setHighlightTicker(null);
    setChangeFilter('ALL');
  }, []);

  const saveInstitutionCache = useCallback(
    (
      entry: Omit<InstitutionCacheEntry, 'quarter'> & { quarter: ThirteenFQuarterId | null }
    ) => {
      if (!entry.quarter) return;
      const cached: InstitutionCacheEntry = {
        ...entry,
        quarter: entry.quarter,
      };
      const cik = entry.holdings.summary.cik;
      institutionCacheRef.current.set(institutionCacheKey(cik, entry.quarter), cached);
      const isLatest = entry.holdings.availableQuarters?.some(
        option => option.quarter === entry.quarter && option.isLatest
      );
      if (isLatest) {
        institutionCacheRef.current.set(institutionCacheKey(cik, null), cached);
      }
    },
    []
  );

  const restoreInstitutionCache = useCallback(
    (cik: string, quarter: ThirteenFQuarterId | null): InstitutionCacheEntry | null => {
      const norm = normalizeInstitutionCik(cik);
      if (quarter) {
        return institutionCacheRef.current.get(institutionCacheKey(norm, quarter)) ?? null;
      }
      return institutionCacheRef.current.get(institutionCacheKey(norm, null)) ?? null;
    },
    []
  );

  const loadInstitutionData = useCallback(
    async (options?: { silent?: boolean; refresh?: boolean }) => {
      if (!enabled || !selectedCik) return;

      const requestId = ++loadRequestIdRef.current;
      const requestCik = resolveInstitutionCik(selectedCik);
      const requestQuarter = selectedQuarter;
      const refresh = options?.refresh === true;
      const sortMatches =
        lastLoadedSortRef.current.field === holdingsSort.field &&
        lastLoadedSortRef.current.dir === holdingsSort.dir;

      if (
        !refresh &&
        sortMatches &&
        institutionDataMatchesRequest(
          requestCik,
          requestQuarter,
          holdingsRef.current,
          changesRef.current
        )
      ) {
        return;
      }

      if (refresh) {
        const refreshQuarter = requestQuarter ?? holdingsRef.current?.summary.quarter ?? null;
        if (refreshQuarter) {
          institutionCacheRef.current.delete(institutionCacheKey(requestCik, refreshQuarter));
        }
        institutionCacheRef.current.delete(institutionCacheKey(requestCik, null));
      }

      if (!refresh && sortMatches) {
        const cached = restoreInstitutionCache(requestCik, requestQuarter);
        if (cached && (!requestQuarter || cached.quarter === requestQuarter)) {
          setHoldings(cached.holdings);
          setChanges(cached.changes);
          setSectorEnrichment(cached.sectorEnrichment);
          if (!requestQuarter) {
            setSelectedQuarter(cached.quarter);
            selectedQuarterRef.current = cached.quarter;
          }
          lastLoadedSortRef.current = { field: cached.sortField, dir: cached.sortDir };
          return;
        }
      }

      const silent = options?.silent === true || refresh;

      if (!silent) {
        setLoading(true);
      }
      if (refresh) {
        setRefreshing(true);
      }
      setError(null);

      const isStaleRequest = (): boolean =>
        requestId !== loadRequestIdRef.current ||
        resolveInstitutionCik(selectedCikRef.current) !== requestCik ||
        requestQuarter !== selectedQuarterRef.current;

      try {
        const params = new URLSearchParams();
        if (requestQuarter) params.set('quarter', requestQuarter);
        params.set('sortBy', holdingsSort.field);
        params.set('sortDir', holdingsSort.dir);
        if (refresh) params.set('refresh', 'true');

        const changesParams = new URLSearchParams();
        if (requestQuarter) changesParams.set('quarter', requestQuarter);
        if (refresh) changesParams.set('refresh', 'true');

        const [holdingsRes, changesRes] = await Promise.all([
          apiFetch(`/api/13f/institutions/${selectedCik}/holdings?${params.toString()}`),
          apiFetch(
            `/api/13f/institutions/${selectedCik}/changes${
              changesParams.toString() ? `?${changesParams.toString()}` : ''
            }`
          ),
        ]);

        if (isStaleRequest()) return;

        if (!holdingsRes.ok) throw new Error(await readApiError(holdingsRes));
        if (!changesRes.ok) throw new Error(await readApiError(changesRes));

        const holdingsPayload = unwrapData<ThirteenFHoldingsResponse>(await holdingsRes.json());
        const changesPayload = unwrapData<ThirteenFPositionChangesResponse>(
          await changesRes.json()
        );

        if (isStaleRequest()) return;

        if (
          normalizeInstitutionCik(holdingsPayload.summary.cik) !==
          normalizeInstitutionCik(requestCik)
        ) {
          return;
        }
        if (normalizeInstitutionCik(changesPayload.cik) !== normalizeInstitutionCik(requestCik)) {
          return;
        }

        setHoldings(holdingsPayload);
        setChanges(changesPayload);
        setSectorEnrichment(holdingsPayload.sectorEnrichment ?? null);
        lastLoadedSortRef.current = {
          field: holdingsSort.field,
          dir: holdingsSort.dir,
        };

        const resolvedName = holdingsPayload.summary.institutionName?.trim();
        if (
          resolvedName &&
          !/^\d{10}$/.test(resolvedName.replace(/\D/g, '').padStart(10, '0'))
        ) {
          setWatchlist(prev =>
            prev.map(item =>
              resolveInstitutionCik(item.cik) === requestCik
                ? { ...item, cik: requestCik, name: resolvedName }
                : item
            )
          );
        }

        if (holdingsPayload.summary.quarter) {
          saveInstitutionCache({
            quarter: holdingsPayload.summary.quarter,
            holdings: holdingsPayload,
            changes: changesPayload,
            sectorEnrichment: holdingsPayload.sectorEnrichment ?? null,
            sortField: holdingsSort.field,
            sortDir: holdingsSort.dir,
          });
        }

        const responseQuarter = holdingsPayload.summary.quarter;
        if (responseQuarter && responseQuarter !== selectedQuarterRef.current) {
          setSelectedQuarter(responseQuarter);
          selectedQuarterRef.current = responseQuarter;
        } else if (!requestQuarter && responseQuarter) {
          setSelectedQuarter(responseQuarter);
          selectedQuarterRef.current = responseQuarter;
        }
      } catch (loadError) {
        if (isStaleRequest()) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load 13F data');
      } finally {
        if (!silent && requestId === loadRequestIdRef.current) {
          setLoading(false);
        }
        if (refresh && requestId === loadRequestIdRef.current) {
          setRefreshing(false);
        }
      }
    },
    [
      enabled,
      holdingsSort.dir,
      holdingsSort.field,
      restoreInstitutionCache,
      saveInstitutionCache,
      selectedCik,
      selectedQuarter,
    ]
  );

  const aggregateSelectedCount = aggregateCiks.size;
  const effectiveAggregateMinCount = useMemo(
    () => clampConsensusMinInstitutionCount(aggregateMinInstitutionCount, aggregateSelectedCount),
    [aggregateMinInstitutionCount, aggregateSelectedCount]
  );

  useEffect(() => {
    const clamped = clampConsensusMinInstitutionCount(
      aggregateMinInstitutionCount,
      aggregateSelectedCount
    );
    if (clamped !== aggregateMinInstitutionCount) {
      setAggregateMinInstitutionCountState(clamped);
    }
  }, [aggregateMinInstitutionCount, aggregateSelectedCount]);

  const setAggregateMinInstitutionCount = useCallback(
    (value: number) => {
      setAggregateMinInstitutionCountState(
        clampConsensusMinInstitutionCount(value, aggregateCiks.size)
      );
    },
    [aggregateCiks.size]
  );

  const runAggregate = useCallback(async () => {
    if (!enabled || aggregateCiks.size === 0) return;
    setAggregateLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/13f/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          ciks: [...aggregateCiks],
          quarter: selectedQuarter ?? undefined,
          minInstitutionCount: effectiveAggregateMinCount,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setAggregate(
        unwrapData<ThirteenFAggregateDashboardResponse>(await response.json())
      );
    } catch (aggregateError) {
      setError(
        aggregateError instanceof Error ? aggregateError.message : 'Failed to load aggregate'
      );
    } finally {
      setAggregateLoading(false);
    }
  }, [aggregateCiks, effectiveAggregateMinCount, enabled, selectedQuarter]);

  const stakeLimitPerInstitution = useMemo(() => {
    if (stakeLookbackDays === 0) return 50;
    if (stakeLookbackDays <= 90) return 20;
    if (stakeLookbackDays <= 180) return 40;
    if (stakeLookbackDays <= 365) return 100;
    return 150;
  }, [stakeLookbackDays]);

  const stakeFeedLimit = useMemo(() => {
    if (stakeLookbackDays === 0) return 150;
    if (stakeLookbackDays <= 90) return 80;
    if (stakeLookbackDays <= 180) return 120;
    if (stakeLookbackDays <= 365) return 200;
    return 300;
  }, [stakeLookbackDays]);

  const stakeLookbackInitializedRef = useRef(false);
  const loadStakeFeedRef = useRef<((options?: { refresh?: boolean }) => Promise<void>) | null>(null);
  const stakeCiksRef = useRef(stakeCiks);
  const stakeFeedRef = useRef(stakeFeed);
  const stakeFeedInflightRef = useRef(false);

  const loadStakeFeed = useCallback(
    async (options?: { refresh?: boolean }) => {
      const ciks = [...stakeCiks];
      if (!enabled || ciks.length === 0) {
        setStakeFeedError(null);
        return;
      }
      if (stakeFeedInflightRef.current) return;

      const sinceDate = computeStakeSinceDate(stakeLookbackDays);
      stakeFeedInflightRef.current = true;
      setStakeFeedLoading(true);
      setStakeFeedError(null);
      setError(null);
      try {
        const endpoint = options?.refresh ? '/api/13f/stake-feed/refresh' : '/api/13f/stake-feed';
        const response = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            ciks,
            limit: stakeFeedLimit,
            limitPerInstitution: stakeLimitPerInstitution,
            sinceDate,
            lookbackDays: stakeLookbackDays,
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = unwrapData<ThirteenFStakeFeedResponse>(await response.json());
        setStakeFeed(payload);
        if (payload.filings.length === 0) {
          setStakeFeedError(null);
        }
      } catch (stakeFeedLoadError) {
        const message =
          stakeFeedLoadError instanceof Error ? stakeFeedLoadError.message : 'Failed to load stake feed';
        setStakeFeedError(message);
        setError(message);
        setStakeFeed(null);
      } finally {
        stakeFeedInflightRef.current = false;
        setStakeFeedLoading(false);
      }
    },
    [enabled, stakeCiks, stakeFeedLimit, stakeLimitPerInstitution, stakeLookbackDays]
  );

  loadStakeFeedRef.current = loadStakeFeed;

  useEffect(() => {
    stakeCiksRef.current = stakeCiks;
  }, [stakeCiks]);

  useEffect(() => {
    stakeFeedRef.current = stakeFeed;
  }, [stakeFeed]);

  useEffect(() => {
    if (stakeCiks.size === 0) {
      setStakeFeed(null);
      setStakeFeedError(null);
      setStakeEnrichments({});
      setStakeChangeLoadingIds(new Set());
    }
  }, [stakeCiks.size]);

  useEffect(() => {
    if (!stakeLookbackInitializedRef.current) {
      stakeLookbackInitializedRef.current = true;
      return;
    }
    if (stakeCiksRef.current.size === 0) return;
    if (!stakeFeedRef.current) return;

    const timer = window.setTimeout(() => {
      if (stakeCiksRef.current.size === 0) return;
      if (!stakeFeedRef.current) return;
      loadStakeFeedRef.current?.({ refresh: true });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [stakeLookbackDays]);

  const enrichStakeOwnership = useCallback(
    async (filings: ThirteenFStakeFiling[]) => {
      if (!enabled || filings.length === 0) return;
      const requestId = stakeEnrichRequestRef.current + 1;
      stakeEnrichRequestRef.current = requestId;
      setStakeOwnershipLoading(true);
      try {
        const response = await apiFetch('/api/13f/stake-feed/parse', {
          method: 'POST',
          body: JSON.stringify({
            filings: filings.map(filing => ({
              accessionNumber: filing.accessionNumber,
              documentUrl: filing.documentUrl,
              formType: filing.formType,
              filingDate: filing.filingDate,
              filerCik: filing.filerCik,
              filerName: filing.filerName,
              fileNumber: filing.fileNumber,
              targetCompanyName: filing.targetCompanyName,
              targetCompanyCik: filing.targetCompanyCik,
            })),
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        if (requestId !== stakeEnrichRequestRef.current) return;
        const payload = unwrapData<ThirteenFStakeParseResponse>(await response.json());
        setStakeEnrichments(prev => {
          const next = { ...prev };
          for (const row of payload.enrichments) {
            next[row.accessionNumber] = { ...next[row.accessionNumber], ...row };
          }
          return next;
        });
      } catch (ownershipEnrichError) {
        console.warn(
          '[13f-stake] ownership enrich failed:',
          ownershipEnrichError instanceof Error ? ownershipEnrichError.message : ownershipEnrichError
        );
      } finally {
        if (requestId === stakeEnrichRequestRef.current) {
          setStakeOwnershipLoading(false);
        }
      }
    },
    [enabled]
  );

  const applyStakeBackfillEnrichments = useCallback(
    (enrichments: ThirteenFStakeBackfillResponse['enrichments']) => {
      setStakeEnrichments(prev => {
        const next = { ...prev };
        for (const row of enrichments) {
          next[row.accessionNumber] = { ...next[row.accessionNumber], ...row };
        }
        return next;
      });
    },
    []
  );

  const runStakeChangeForFiling = useCallback(
    async (filing: ThirteenFStakeFiling) => {
      if (!enabled || filing.ownershipPct == null) return;

      const loadingKey = filing.id;
      setStakeChangeLoadingIds(prev => new Set(prev).add(loadingKey));
      try {
        const response = await apiFetch('/api/13f/stake-feed/backfill-prior', {
          method: 'POST',
          body: JSON.stringify({
            filings: [
              {
                accessionNumber: filing.accessionNumber,
                documentUrl: filing.documentUrl,
                formType: filing.formType,
                filingDate: filing.filingDate,
                filerCik: filing.filerCik,
                filerName: filing.filerName,
                targetCompanyName: filing.targetCompanyName,
                targetCompanyCik: filing.targetCompanyCik,
                ownershipPct: filing.ownershipPct,
                mergedAccessionNumbers: filing.mergedAccessionNumbers,
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = unwrapData<ThirteenFStakeBackfillResponse>(await response.json());
        applyStakeBackfillEnrichments(payload.enrichments);
      } catch (backfillError) {
        console.warn(
          '[13f-stake] prior backfill failed:',
          backfillError instanceof Error ? backfillError.message : backfillError
        );
      } finally {
        setStakeChangeLoadingIds(prev => {
          const next = new Set(prev);
          next.delete(loadingKey);
          return next;
        });
      }
    },
    [enabled, applyStakeBackfillEnrichments]
  );

  useEffect(() => {
    if (!stakeFeed?.filings.length) {
      setStakeEnrichments({});
      setStakeChangeLoadingIds(new Set());
      return;
    }
    void enrichStakeOwnership(stakeFeed.filings);
  }, [stakeFeed?.fetchedAt, enrichStakeOwnership]);

  const stakeFilingsEnriched = useMemo(() => {
    if (!stakeFeed) return [];
    const enriched = stakeFeed.filings.map(filing => {
      const enrichment = stakeEnrichments[filing.accessionNumber];
      return enrichment ? { ...filing, ...enrichment } : filing;
    });
    return mergeSameDayStakeFilings(enriched);
  }, [stakeFeed, stakeEnrichments]);

  useEffect(() => {
    performanceSortModeRef.current = performanceSortMode;
  }, [performanceSortMode]);

  useEffect(() => {
    if (!performance) return;
    setPerformance(prev =>
      prev
        ? {
            ...prev,
            sortMode: performanceSortMode,
            entries: sortPerformanceEntries(prev.entries, performanceSortMode),
          }
        : prev
    );
  }, [performanceSortMode]);

  const loadPerformance = useCallback(
    async (options?: { refresh?: boolean }) => {
      if (!enabled || !performanceCik) return;

      const refresh = options?.refresh === true;
      const ciks = [performanceCik];
      const cacheKey = buildPerformanceCacheKey(ciks, selectedQuarter);
      const sortMode = performanceSortModeRef.current;
      const loadId = ++performanceLoadIdRef.current;

      const isStaleLoad = (): boolean => loadId !== performanceLoadIdRef.current;

      const applyPerformance = (
        data: ThirteenFPerformanceTrackingResponse,
        fetchedAt: string | null
      ) => {
        setPerformance({
          ...data,
          sortMode,
          entries: sortPerformanceEntries(data.entries, sortMode),
        });
        setPerformanceCacheFetchedAt(fetchedAt);
      };

      if (!refresh) {
        const localHit = readPerformanceCache(cacheKey);
        if (localHit) {
          applyPerformance(localHit.data, localHit.fetchedAt);
          return;
        }

        try {
          const cachedResponse = await apiFetch('/api/13f/performance', {
            method: 'POST',
            body: JSON.stringify({
              ciks,
              quarter: selectedQuarter ?? undefined,
              sortMode,
              cachedOnly: true,
            }),
          });
          if (cachedResponse.ok) {
            const payload = unwrapData<ThirteenFPerformanceTrackingResponse>(
              await cachedResponse.json()
            );
            if (isStaleLoad()) return;
            const record = writePerformanceCache(cacheKey, payload);
            applyPerformance(payload, record.fetchedAt);
            return;
          }
        } catch {
          // fall through to full load
        }
      } else {
        clearPerformanceCache();
      }

      setPerformanceLoading(true);
      setPerformanceEnriching(false);
      setPerformanceQuoteProgress(null);
      setPerformanceCacheFetchedAt(null);
      setError(null);

      try {
        const response = await apiFetch('/api/13f/performance', {
          method: 'POST',
          body: JSON.stringify({
            ciks,
            quarter: selectedQuarter ?? undefined,
            sortMode,
            skeleton: true,
            refresh,
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const skeleton = unwrapData<ThirteenFPerformanceTrackingResponse>(await response.json());
        if (isStaleLoad()) return;

        setPerformance({
          ...skeleton,
          sortMode,
          entries: sortPerformanceEntries(skeleton.entries, sortMode),
        });
        setPerformanceLoading(false);

        if (skeleton.entries.length === 0) return;

        setPerformanceEnriching(true);
        setPerformanceQuoteProgress({ loaded: 0, total: skeleton.entries.length });

        for (let index = 0; index < skeleton.entries.length; index += PERFORMANCE_QUOTE_BATCH) {
          if (isStaleLoad()) return;

          const batch = skeleton.entries.slice(index, index + PERFORMANCE_QUOTE_BATCH);
          const enrichResponse = await apiFetch('/api/13f/performance/enrich', {
            method: 'POST',
            body: JSON.stringify({
              entries: batch.map(entry => ({
                ticker: entry.ticker,
                anchorDate: entry.anchorDate,
                reportDate: entry.reportDate,
                impliedReferencePriceUsd: entry.impliedReferencePriceUsd,
              })),
            }),
          });
          if (!enrichResponse.ok) throw new Error(await readApiError(enrichResponse));
          const enriched = unwrapData<{ quotes: ThirteenFPerformanceQuoteEnrichment[] }>(
            await enrichResponse.json()
          );
          if (isStaleLoad()) return;

          setPerformance(prev => {
            if (!prev) return prev;
            const quoteByTicker = new Map(enriched.quotes.map(quote => [quote.ticker, quote]));
            const entries = prev.entries.map(entry => {
              const quote = quoteByTicker.get(entry.ticker);
              if (!quote) return entry;
              return {
                ...entry,
                anchorPriceUsd: quote.anchorPriceUsd,
                reportPriceUsd: quote.reportPriceUsd,
                currentPriceUsd: quote.currentPriceUsd,
                returnPct: quote.returnPct,
                reportReturnPct: quote.reportReturnPct,
                quoteStatus: quote.quoteStatus,
              };
            });
            return {
              ...prev,
              sortMode,
              entries: sortPerformanceEntries(entries, sortMode),
            };
          });
          setPerformanceQuoteProgress({
            loaded: Math.min(index + batch.length, skeleton.entries.length),
            total: skeleton.entries.length,
          });
        }

        if (isStaleLoad()) return;

        setPerformance(prev => {
          if (!prev) return prev;
          const finalData: ThirteenFPerformanceTrackingResponse = {
            ...prev,
            sortMode,
            entries: sortPerformanceEntries(prev.entries, sortMode),
          };
          const record = writePerformanceCache(cacheKey, finalData);
          setPerformanceCacheFetchedAt(record.fetchedAt);
          void apiFetch('/api/13f/performance/cache', {
            method: 'PUT',
            body: JSON.stringify({
              ciks,
              quarter: selectedQuarter ?? undefined,
              sortMode,
              data: finalData,
            }),
          }).catch(() => {
            // best-effort server cache warm
          });
          return finalData;
        });
      } catch (performanceError) {
        if (isStaleLoad()) return;
        setError(
          performanceError instanceof Error ? performanceError.message : 'Failed to load performance'
        );
      } finally {
        if (!isStaleLoad()) {
          setPerformanceLoading(false);
          setPerformanceEnriching(false);
          setPerformanceQuoteProgress(null);
        }
      }
    },
    [enabled, performanceCik, selectedQuarter]
  );

  useEffect(() => {
    if (!enabled) return;
    void loadPresets().catch(() => {
      // Presets are optional if request fails.
    });
  }, [enabled, loadPresets]);

  useEffect(() => {
    if (!enabled) {
      setUserStateReady(false);
      return;
    }

    let cancelled = false;
    setUserStateReady(false);
    skipPersistUserStateRef.current = true;

    void (async () => {
      try {
        const response = await apiFetch('/api/13f/user-state');
        if (cancelled || !response.ok) return;

        const remote = unwrapData<ThirteenFUserTrackerState>(await response.json());
        skipPersistUserStateRef.current = true;

        if (remote.watchlist.length > 0) {
          const migrated = remote.watchlist.map(migrateWatchlistItem);
          setWatchlist(migrated);
          setStarredCiks(new Set(remote.starredCiks.map(resolveInstitutionCik)));
          setStakeCiks(new Set(remote.stakeCiks.map(resolveInstitutionCik)));
          setStakeLookbackDays(remote.stakeLookbackDays);
          setSelectedCik(migrated[0]?.cik ?? DEFAULT_CIK);
          return;
        }

        const local = readLocalTrackerState();
        const likelyLegacyAutoSeed =
          local.watchlist.length === 1 &&
          resolveInstitutionCik(local.watchlist[0]!.cik) === DEFAULT_CIK;
        if (local.watchlist.length > 0 && !likelyLegacyAutoSeed) {
          setWatchlist(local.watchlist);
          setStarredCiks(new Set(local.starredCiks));
          setStakeCiks(new Set(local.stakeCiks));
          setStakeLookbackDays(local.stakeLookbackDays);
          setSelectedCik(local.watchlist[0]?.cik ?? DEFAULT_CIK);
          skipPersistUserStateRef.current = true;
          await apiFetch('/api/13f/user-state', {
            method: 'PUT',
            body: JSON.stringify(local),
          });
        }
      } catch (loadStateError) {
        console.warn(
          '[13f] user state load failed:',
          loadStateError instanceof Error ? loadStateError.message : loadStateError
        );
      } finally {
        if (!cancelled) {
          setUserStateReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !userStateReady) return;
    if (skipPersistUserStateRef.current) {
      skipPersistUserStateRef.current = false;
      return;
    }

    const payload: ThirteenFUserTrackerState = {
      watchlist,
      starredCiks: [...starredCiks],
      stakeCiks: [...stakeCiks],
      stakeLookbackDays,
    };

    const timer = window.setTimeout(() => {
      void apiFetch('/api/13f/user-state', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }).catch(saveError => {
        console.warn(
          '[13f] user state save failed:',
          saveError instanceof Error ? saveError.message : saveError
        );
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [enabled, userStateReady, watchlist, starredCiks, stakeCiks, stakeLookbackDays]);

  useEffect(() => {
    if (!enabled || !userStateReady || watchlist.length > 0 || presets.length === 0) return;
    const seeded = buildWatchlistFromPresets(presets);
    if (seeded.length === 0) return;
    skipPersistUserStateRef.current = true;
    setWatchlist(seeded);
    setSelectedCik(seeded[0]?.cik ?? DEFAULT_CIK);
  }, [enabled, presets, userStateReady, watchlist.length]);

  useEffect(() => {
    if (!enabled || activePanel !== 'institution') return;
    void loadInstitutionData();
  }, [activePanel, enabled, loadInstitutionData]);

  useEffect(() => {
    if (!enabled || activePanel !== 'institution') return;
    if (sectorEnrichment?.status !== 'running') return;

    const pollCik = selectedCik;
    const pollQuarter = selectedQuarter;
    const quarterParam = pollQuarter ? `?quarter=${pollQuarter}` : '';
    const timer = window.setInterval(() => {
      void (async () => {
        if (resolveInstitutionCik(selectedCikRef.current) !== resolveInstitutionCik(pollCik)) {
          return;
        }
        if (selectedQuarterRef.current !== pollQuarter) {
          return;
        }
        try {
          const response = await apiFetch(
            `/api/13f/institutions/${pollCik}/sector-enrichment${quarterParam}`
          );
          if (!response.ok) return;
          if (resolveInstitutionCik(selectedCikRef.current) !== resolveInstitutionCik(pollCik)) {
            return;
          }
          const payload = unwrapData<ThirteenFSectorEnrichmentStatus>(await response.json());
          setSectorEnrichment(payload);
          if (payload.status === 'complete') {
            await loadInstitutionData({ silent: true });
          }
        } catch {
          // polling is best-effort
        }
      })();
    }, 2500);

    return () => window.clearInterval(timer);
  }, [
    activePanel,
    enabled,
    loadInstitutionData,
    sectorEnrichment?.status,
    selectedCik,
    selectedQuarter,
  ]);

  useEffect(() => {
    if (!enabled || activePanel !== 'aggregate') return;
    void runAggregate();
  }, [activePanel, enabled, runAggregate]);

  useEffect(() => {
    if (!enabled || activePanel !== 'performance') return;
    void loadPerformance();
  }, [activePanel, enabled, loadPerformance]);

  const selectCik = useCallback(
    (cik: string) => {
      loadRequestIdRef.current += 1;
      const requestCik = resolveInstitutionCik(cik);
      const prevCik = resolveInstitutionCik(selectedCikRef.current);

      setSelectedCik(cik);
      selectedCikRef.current = cik;

      if (requestCik === prevCik) return;

      const cached =
        restoreInstitutionCache(requestCik, selectedQuarterRef.current) ??
        (() => {
          const latest = restoreInstitutionCache(requestCik, null);
          if (!latest) return null;
          if (
            selectedQuarterRef.current &&
            latest.quarter !== selectedQuarterRef.current
          ) {
            return null;
          }
          return latest;
        })();
      if (cached) {
        setHoldings(cached.holdings);
        setChanges(cached.changes);
        setSectorEnrichment(cached.sectorEnrichment);
        if (!selectedQuarterRef.current) {
          setSelectedQuarter(cached.quarter);
          selectedQuarterRef.current = cached.quarter;
        }
        lastLoadedSortRef.current = { field: cached.sortField, dir: cached.sortDir };
        setHighlightTicker(null);
        setChangeFilter('ALL');
        return;
      }

      clearInstitutionData();
      setSelectedQuarter(null);
      selectedQuarterRef.current = null;
    },
    [clearInstitutionData, restoreInstitutionCache]
  );

  const addInstitution = useCallback(
    (institution: ThirteenFInstitution) => {
      const cik = resolveInstitutionCik(institution.cik);
      setWatchlist(prev => {
        if (prev.some(item => resolveInstitutionCik(item.cik) === cik)) return prev;
        return [
          ...prev,
          {
            cik,
            name: institution.shortName ?? institution.name,
            addedAt: new Date().toISOString(),
            sortOrder: prev.length,
          },
        ];
      });
      selectCik(cik);
    },
    [selectCik]
  );

  const selectInstitution = useCallback(
    (institution: ThirteenFInstitution) => {
      addInstitution(institution);
      setActivePanel('institution');
      setInstitutionSearchQuery('');
      setInstitutionSearchResults([]);
    },
    [addInstitution]
  );

  useEffect(() => {
    if (!enabled) return;
    const query = institutionSearchQuery.trim();
    if (query.length < institutionSearchMinQueryLength(query)) {
      setInstitutionSearchResults([]);
      setInstitutionSearchLoading(false);
      return;
    }

    setInstitutionSearchLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch(
            `/api/13f/institutions/search?${new URLSearchParams({ q: query }).toString()}`
          );
          if (!response.ok) throw new Error(await readApiError(response));
          const payload = unwrapData<{ items: ThirteenFInstitution[] }>(
            await response.json()
          );
          setInstitutionSearchResults(payload.items ?? []);
        } catch {
          setInstitutionSearchResults([]);
        } finally {
          setInstitutionSearchLoading(false);
        }
      })();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [enabled, institutionSearchQuery]);

  const removeInstitution = useCallback(
    (cik: string) => {
      const normalized = resolveInstitutionCik(cik);
      setWatchlist(prev => prev.filter(item => resolveInstitutionCik(item.cik) !== normalized));
      setStarredCiks(prev => {
        if (!prev.has(normalized)) return prev;
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      if (resolveInstitutionCik(selectedCik) === normalized) {
        const remaining = watchlist.filter(item => resolveInstitutionCik(item.cik) !== normalized);
        selectCik(remaining[0]?.cik ?? presets[0]?.cik ?? DEFAULT_CIK);
      }
      setAggregateCiks(prev => {
        const next = new Set(prev);
        next.delete(resolveInstitutionCik(cik));
        return next;
      });
      setStakeCiks(prev => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      if (performanceCik != null && resolveInstitutionCik(performanceCik) === normalized) {
        setPerformanceCik(null);
      }
    },
    [performanceCik, presets, selectedCik, watchlist, selectCik]
  );

  const selectPerformanceCik = useCallback((cik: string) => {
    setPerformanceCik(prev => (prev === cik ? null : cik));
  }, []);

  const toggleAggregateCik = useCallback((cik: string) => {
    const normalized = resolveInstitutionCik(cik);
    setAggregateCiks(prev => {
      const next = new Set([...prev].map(resolveInstitutionCik));
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  }, []);

  const toggleStakeCik = useCallback((cik: string) => {
    const normalized = resolveInstitutionCik(cik);
    setStakeCiks(prev => {
      const next = new Set([...prev].map(resolveInstitutionCik));
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  }, []);

  const selectAllStakeCiks = useCallback(() => {
    setStakeCiks(new Set(watchlist.map(item => resolveInstitutionCik(item.cik))));
  }, [watchlist]);

  const clearStakeCiks = useCallback(() => {
    setStakeCiks(new Set());
  }, []);

  const setStakeLookbackDays = useCallback((days: ThirteenFStakeLookbackDays) => {
    setStakeLookbackDaysState(days);
  }, []);

  const filteredChanges = useMemo(() => {
    if (!changes) return [];
    if (changeFilter === 'ALL') return changes.changes;
    return changes.changes.filter(change => change.category === changeFilter);
  }, [changeFilter, changes]);

  const toggleStarInstitution = useCallback(
    (cik: string) => {
      const normalized = resolveInstitutionCik(cik);
      const inWatchlist = watchlist.some(item => resolveInstitutionCik(item.cik) === normalized);
      if (!inWatchlist) return;
      setStarredCiks(prev => {
        const next = new Set(prev);
        if (next.has(normalized)) {
          next.delete(normalized);
        } else {
          next.add(normalized);
        }
        return next;
      });
    },
    [watchlist]
  );

  const isInstitutionStarred = useCallback(
    (cik: string) => starredCiks.has(resolveInstitutionCik(cik)),
    [starredCiks]
  );

  const featuredInstitutions = useMemo(
    () =>
      watchlist.filter(item => starredCiks.has(resolveInstitutionCik(item.cik))),
    [watchlist, starredCiks]
  );

  const institutionOptions = useMemo(() => {
    const map = new Map<string, ThirteenFInstitution>();
    for (const preset of presets) map.set(preset.cik, preset);
    for (const item of watchlist) {
      if (!map.has(item.cik)) {
        map.set(item.cik, { cik: item.cik, name: item.name, shortName: item.name });
      }
    }
    return [...map.values()];
  }, [presets, watchlist]);

  return {
    language,
    watchlist,
    featuredInstitutions,
    starredCiks,
    toggleStarInstitution,
    isInstitutionStarred,
    presets,
    institutionOptions,
    selectedCik,
    selectCik,
    setSelectedCik,
    selectedQuarter,
    setSelectedQuarter,
    holdings,
    holdingsSort,
    setHoldingsSort,
    changes,
    filteredChanges,
    changeFilter,
    setChangeFilter,
    highlightTicker,
    setHighlightTicker,
    aggregateCiks,
    toggleAggregateCik,
    aggregateMinInstitutionCount: effectiveAggregateMinCount,
    setAggregateMinInstitutionCount,
    aggregateSelectedCount,
    performanceCik,
    selectPerformanceCik,
    aggregate,
    performanceSortMode,
    setPerformanceSortMode,
    performance,
    activePanel,
    setActivePanel,
    loading,
    refreshing,
    sectorEnrichment,
    aggregateLoading,
    performanceLoading,
    performanceEnriching,
    performanceQuoteProgress,
    performanceCacheFetchedAt,
    error,
    addInstitution,
    removeInstitution,
    selectInstitution,
    institutionSearchQuery,
    setInstitutionSearchQuery,
    institutionSearchResults,
    institutionSearchLoading,
    reload: () => loadInstitutionData(),
    refreshInstitution: () => loadInstitutionData({ refresh: true }),
    runAggregate,
    loadPerformance,
    refreshPerformance: () => loadPerformance({ refresh: true }),
    stakeFeed,
    stakeFeedLoading,
    stakeFeedError,
    stakeCiks,
    stakeLookbackDays,
    toggleStakeCik,
    selectAllStakeCiks,
    clearStakeCiks,
    setStakeLookbackDays,
    loadStakeFeed,
    runStakeFeed: () => loadStakeFeed(),
    refreshStakeFeed: () => loadStakeFeed({ refresh: true }),
    stakeFilingsEnriched,
    stakeOwnershipLoading,
    stakeChangeLoadingIds,
    runStakeChangeForFiling,
    stakeEnrichments,
  };
};

export type ThirteenFTrackerState = ReturnType<typeof useThirteenFTracker>;
