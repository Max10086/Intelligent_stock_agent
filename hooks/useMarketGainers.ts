import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Language } from '../types.ts';
import type {
  GainerMarket,
  GainerPeriod,
  MarketGainerEntryDto,
  MarketGainerHistoryItemDto,
  MarketGainerListResponse,
  UserGainerPreferenceDto,
} from '../types/marketGainers.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

const POLL_MS = 60_000;
const VALIDATE_QUOTES_STORAGE_KEY = 'gainer_validate_quotes';
const SELECTED_DATE_STORAGE_PREFIX = 'gainer_selected_date_';

const readValidateQuotesPref = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(VALIDATE_QUOTES_STORAGE_KEY) === 'true';
};

const writeValidateQuotesPref = (value: boolean): void => {
  window.localStorage.setItem(VALIDATE_QUOTES_STORAGE_KEY, value ? 'true' : 'false');
};

const selectedDateStorageKey = (market: GainerMarket, period: GainerPeriod): string =>
  `${SELECTED_DATE_STORAGE_PREFIX}${market}_${period}`;

const readSelectedTradingDateEnd = (
  market: GainerMarket,
  period: GainerPeriod
): string | null => {
  if (typeof window === 'undefined') return null;
  const value = window.sessionStorage.getItem(selectedDateStorageKey(market, period));
  return value && value.length > 0 ? value : null;
};

const writeSelectedTradingDateEnd = (
  market: GainerMarket,
  period: GainerPeriod,
  value: string | null
): void => {
  const key = selectedDateStorageKey(market, period);
  if (!value) {
    window.sessionStorage.removeItem(key);
    return;
  }
  window.sessionStorage.setItem(key, value);
};

const periodForMarket = (market: GainerMarket, tab: 'primary' | 'weekly'): GainerPeriod => {
  if (tab === 'weekly') return 'WEEKLY';
  return market === 'CN' ? 'THREE_DAY' : 'DAILY';
};

export const useMarketGainers = (language: Language, enabled: boolean) => {
  const [market, setMarket] = useState<GainerMarket>('US');
  const [periodTab, setPeriodTab] = useState<'primary' | 'weekly'>('primary');
  const [data, setData] = useState<MarketGainerListResponse | null>(null);
  const [history, setHistory] = useState<MarketGainerHistoryItemDto[]>([]);
  const [selectedTradingDateEnd, setSelectedTradingDateEndState] = useState<string | null>(() =>
    readSelectedTradingDateEnd('US', 'DAILY')
  );
  const [preferences, setPreferences] = useState<UserGainerPreferenceDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [validateQuotes, setValidateQuotesState] = useState(readValidateQuotesPref);
  const [submitting, setSubmitting] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => periodForMarket(market, periodTab), [market, periodTab]);

  const setSelectedTradingDateEnd = useCallback(
    (value: string | null) => {
      writeSelectedTradingDateEnd(market, period, value);
      setSelectedTradingDateEndState(value);
    },
    [market, period]
  );

  const setValidateQuotes = useCallback((value: boolean) => {
    writeValidateQuotesPref(value);
    setValidateQuotesState(value);
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!enabled) return;
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const historyRes = await apiFetch(
        `/api/market/gainers/history?${new URLSearchParams({ market, period, limit: '60' }).toString()}`
      );
      if (!historyRes.ok) throw new Error(await readApiError(historyRes));
      const historyPayload = (await historyRes.json()) as { items: MarketGainerHistoryItemDto[] };
      const historyItems = historyPayload.items || [];
      setHistory(historyItems);

      let dateToLoad = selectedTradingDateEnd;
      if (dateToLoad && !historyItems.some(item => item.tradingDateEnd === dateToLoad)) {
        dateToLoad = null;
        writeSelectedTradingDateEnd(market, period, null);
        setSelectedTradingDateEndState(null);
      }

      const params = new URLSearchParams({ market, period });
      if (dateToLoad) {
        params.set('tradingDateEnd', dateToLoad);
      }

      const [listRes, prefRes] = await Promise.all([
        apiFetch(`/api/market/gainers?${params.toString()}`),
        apiFetch('/api/market/gainers/preferences'),
      ]);
      if (!listRes.ok) throw new Error(await readApiError(listRes));
      if (!prefRes.ok) throw new Error(await readApiError(prefRes));
      setData((await listRes.json()) as MarketGainerListResponse);
      setPreferences((await prefRes.json()) as UserGainerPreferenceDto);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load gainers');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [enabled, market, period, selectedTradingDateEnd]);

  const loadLatest = useCallback(() => {
    setSelectedTradingDateEnd(null);
  }, [setSelectedTradingDateEnd]);

  const fetchGainers = useCallback(
    async (options?: { fetchAll?: boolean; runAutoAnalyze?: boolean }) => {
      if (!enabled) return false;
      setFetching(true);
      setError(null);
      setFetchMessage(null);
      try {
        const response = await apiFetch('/api/market/gainers/fetch', {
          method: 'POST',
          body: JSON.stringify({
            market,
            period,
            fetchAll: options?.fetchAll ?? false,
            runAutoAnalyze: options?.runAutoAnalyze ?? false,
            validateQuotes,
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = (await response.json()) as { jobs?: Array<{ result?: { entryCount?: number } }> };
        const entryCount = payload.jobs?.reduce(
          (sum, job) => sum + (job.result?.entryCount ?? 0),
          0
        );
        setFetchMessage(
          language === 'cn'
            ? `抓取完成${entryCount ? `，共 ${entryCount} 条记录` : ''}`
            : `Fetch completed${entryCount ? ` (${entryCount} entries)` : ''}`
        );
        setSelectedTradingDateEnd(null);
        await load({ silent: true });
        return true;
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch gainers');
        return false;
      } finally {
        setFetching(false);
      }
    },
    [enabled, language, load, market, period, setSelectedTradingDateEnd, validateQuotes]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => void load({ silent: true }), POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  useEffect(() => {
    setSelected(new Set());
  }, [market, period, selectedTradingDateEnd]);

  useEffect(() => {
    const stored = readSelectedTradingDateEnd(market, period);
    setSelectedTradingDateEndState(stored);
  }, [market, period]);

  const toggleSelected = (ticker: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const selectAll = (entries: MarketGainerEntryDto[]) => {
    setSelected(new Set(entries.map(entry => entry.ticker)));
  };

  const analyzeTickers = async (tickers: string[]) => {
    if (tickers.length === 0) return null;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch('/api/market/gainers/analyze', {
        method: 'POST',
        body: JSON.stringify({ tickers, language }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return (await response.json()) as { batchJobId: string; jobCount: number };
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start analysis');
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const savePreferences = async (patch: Partial<UserGainerPreferenceDto>) => {
    setSavingPrefs(true);
    setError(null);
    try {
      const response = await apiFetch('/api/market/gainers/preferences', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setPreferences((await response.json()) as UserGainerPreferenceDto);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save preferences');
    } finally {
      setSavingPrefs(false);
    }
  };

  return {
    market,
    setMarket,
    periodTab,
    setPeriodTab,
    period,
    data,
    history,
    selectedTradingDateEnd,
    setSelectedTradingDateEnd,
    loadLatest,
    preferences,
    selected,
    loading,
    fetching,
    fetchMessage,
    submitting,
    savingPrefs,
    error,
    load,
    fetchGainers,
    validateQuotes,
    setValidateQuotes,
    toggleSelected,
    selectAll,
    analyzeTickers,
    savePreferences,
  };
};
