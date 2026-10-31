import { getQuotePrice } from '../../services/finance.js';
import { computeReturnPct } from '../../utils/priceFormat.js';

const CONCURRENCY = 12;

const historicalCloseCache = new Map<string, { close: number; cachedAt: number }>();
const HISTORICAL_CLOSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_CACHE_KEY_PREFIX = 'v4';

const nasdaqInfoBoundsCache = new Map<
  string,
  { bounds: NasdaqInfoBounds | null; cachedAt: number }
>();
const NASDAQ_INFO_CACHE_TTL_MS = 60 * 60 * 1000;

const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

export type HistoricalClosePickMode = 'on_or_after' | 'on_or_before';

const normalizeTicker = (ticker: string): string => ticker.trim().toUpperCase();

const runPool = async <T, R>(
  items: T[],
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const slice = items.slice(start, start + CONCURRENCY);
    const sliceResults = await Promise.all(slice.map(item => worker(item)));
    for (let offset = 0; offset < sliceResults.length; offset += 1) {
      results[start + offset] = sliceResults[offset];
    }
  }
  return results;
};

const parseUsPrice = (raw: string): number | null => {
  const parsed = Number.parseFloat(String(raw || '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseNasdaqDate = (value: string): Date | null => {
  if (!value) return null;
  const [mm, dd, yyyy] = value.split('/');
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
};

const isoDateFmt = (date: Date): string => date.toISOString().slice(0, 10);

const parseFiftyTwoWeekRange = (
  raw: string | undefined
): { low: number; high: number } | null => {
  if (!raw) return null;
  const [lowRaw, highRaw] = raw.split('-').map(part => part.trim());
  const low = parseUsPrice(lowRaw ?? '');
  const high = parseUsPrice(highRaw ?? '');
  if (low == null || high == null) return null;
  return { low, high };
};

const pickHistoricalClose = (
  rows: Array<{ date: Date; close: number }>,
  target: Date,
  mode: HistoricalClosePickMode
): number | null => {
  if (rows.length === 0) return null;
  if (mode === 'on_or_before') {
    let best: number | null = null;
    for (const row of rows) {
      if (row.date.getTime() <= target.getTime()) {
        best = row.close;
      } else {
        break;
      }
    }
    return best ?? rows[0]?.close ?? null;
  }
  for (const row of rows) {
    if (row.date.getTime() >= target.getTime()) {
      return row.close;
    }
  }
  return rows[rows.length - 1]?.close ?? null;
};

const isPlausibleHistoricalClose = (
  close: number,
  bounds: { low: number; high: number } | null
): boolean => {
  if (!bounds) return true;
  const span = Math.max(bounds.high - bounds.low, bounds.low * 0.05);
  const buffer = span * 0.12;
  return close >= bounds.low - buffer && close <= bounds.high + buffer;
};

type NasdaqInfoBounds = {
  symbol: string;
  low: number;
  high: number;
};

const fetchNasdaqInfoBounds = async (ticker: string): Promise<NasdaqInfoBounds | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const cached = nasdaqInfoBoundsCache.get(normalizedTicker);
  if (cached && Date.now() - cached.cachedAt < NASDAQ_INFO_CACHE_TTL_MS) {
    return cached.bounds;
  }

  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    normalizedTicker
  )}/info?assetclass=stocks`;

  let bounds: NasdaqInfoBounds | null = null;
  try {
    const response = await fetch(url, { headers: NASDAQ_HEADERS });
    if (response.ok) {
      const json = (await response.json()) as {
        data?: {
          symbol?: string;
          keyStats?: { fiftyTwoWeekHighLow?: { value?: string } };
        };
      };
      const symbol = normalizeTicker(json?.data?.symbol ?? normalizedTicker);
      if (symbol === normalizedTicker) {
        const range = parseFiftyTwoWeekRange(json?.data?.keyStats?.fiftyTwoWeekHighLow?.value);
        if (range) {
          bounds = { symbol, low: range.low, high: range.high };
        }
      }
    }
  } catch {
    bounds = null;
  }

  nasdaqInfoBoundsCache.set(normalizedTicker, { bounds, cachedAt: Date.now() });
  return bounds;
};

const fetchNasdaqHistoricalRows = async (
  ticker: string,
  fromDate: string,
  toDate: string
): Promise<Array<{ date: Date; close: number }>> => {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
    ticker
  )}/historical?assetclass=stocks&fromdate=${fromDate}&todate=${toDate}&limit=200`;

  const response = await fetch(url, { headers: NASDAQ_HEADERS });
  if (!response.ok) return [];

  const json = (await response.json()) as {
    data?: { tradesTable?: { rows?: Array<{ date?: string; close?: string }> } };
  };
  const rows = json?.data?.tradesTable?.rows;
  if (!Array.isArray(rows)) return [];

  return rows
    .map(row => {
      const date = parseNasdaqDate(row.date || '');
      const close = parseUsPrice(row.close || '');
      if (!date || close == null) return null;
      return { date, close };
    })
    .filter((row): row is { date: Date; close: number } => row != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
};

const resolveNasdaqHistoricalClose = (
  rows: Array<{ date: Date; close: number }>,
  anchorDateIso: string,
  mode: HistoricalClosePickMode,
  bounds: NasdaqInfoBounds | null
): number | null => {
  const target = new Date(`${anchorDateIso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const close = pickHistoricalClose(rows, target, mode);
  if (close == null) return null;
  if (!isPlausibleHistoricalClose(close, bounds)) return null;
  return close;
};

const fetchNasdaqHistoricalClosesForTicker = async (
  ticker: string,
  dateRequests: Array<{ anchorDateIso: string; mode: HistoricalClosePickMode }>
): Promise<Array<{ anchorDateIso: string; mode: HistoricalClosePickMode; close: number | null }>> => {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker || dateRequests.length === 0) {
    return [];
  }

  const bounds = await fetchNasdaqInfoBounds(normalizedTicker);

  const targets = dateRequests
    .map(request => new Date(`${request.anchorDateIso}T00:00:00Z`))
    .filter(date => !Number.isNaN(date.getTime()));
  if (targets.length === 0) {
    return dateRequests.map(request => ({ ...request, close: null }));
  }

  const rangeStart = new Date(Math.min(...targets.map(date => date.getTime())));
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 7);
  const rangeEnd = new Date(Math.max(...targets.map(date => date.getTime())));
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 14);

  let rows: Array<{ date: Date; close: number }> = [];
  try {
    rows = await fetchNasdaqHistoricalRows(
      normalizedTicker,
      isoDateFmt(rangeStart),
      isoDateFmt(rangeEnd)
    );
  } catch {
    rows = [];
  }

  return dateRequests.map(request => ({
    ...request,
    close: resolveNasdaqHistoricalClose(rows, request.anchorDateIso, request.mode, bounds),
  }));
};

const cacheHistoricalClose = (
  ticker: string,
  anchorDateIso: string,
  mode: HistoricalClosePickMode,
  close: number | null
): number | null => {
  if (close == null) return null;
  const cacheKey = `${HISTORICAL_CACHE_KEY_PREFIX}|${normalizeTicker(ticker)}|${anchorDateIso.trim()}|${mode}`;
  historicalCloseCache.set(cacheKey, { close, cachedAt: Date.now() });
  return close;
};

const readHistoricalCloseCache = (
  ticker: string,
  anchorDateIso: string,
  mode: HistoricalClosePickMode
): number | null => {
  const cacheKey = `${HISTORICAL_CACHE_KEY_PREFIX}|${normalizeTicker(ticker)}|${anchorDateIso.trim()}|${mode}`;
  const cached = historicalCloseCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < HISTORICAL_CLOSE_CACHE_TTL_MS) {
    return cached.close;
  }
  return null;
};

/** Market close on or around the anchor date (YYYY-MM-DD). */
export const fetchHistoricalCloseUsd = async (
  ticker: string,
  anchorDateIso: string,
  mode: HistoricalClosePickMode = 'on_or_after'
): Promise<number | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const trimmedDate = anchorDateIso.trim();
  if (!normalizedTicker || !trimmedDate) return null;

  const cached = readHistoricalCloseCache(normalizedTicker, trimmedDate, mode);
  if (cached != null) return cached;

  const [result] = await fetchNasdaqHistoricalClosesForTicker(normalizedTicker, [
    { anchorDateIso: trimmedDate, mode },
  ]);
  return cacheHistoricalClose(normalizedTicker, trimmedDate, mode, result?.close ?? null);
};

export const fetchHistoricalCloseMapByDate = async (
  requests: Array<{ ticker: string; anchorDateIso: string; mode?: HistoricalClosePickMode }>
): Promise<Map<string, number>> => {
  const unique = new Map<
    string,
    { ticker: string; anchorDateIso: string; mode: HistoricalClosePickMode }
  >();
  for (const request of requests) {
    const ticker = normalizeTicker(request.ticker);
    const anchorDateIso = request.anchorDateIso.trim();
    const mode = request.mode ?? 'on_or_after';
    if (!ticker || !anchorDateIso) continue;
    unique.set(`${ticker}|${anchorDateIso}|${mode}`, { ticker, anchorDateIso, mode });
  }

  const byTicker = new Map<
    string,
    Array<{ anchorDateIso: string; mode: HistoricalClosePickMode }>
  >();
  for (const entry of unique.values()) {
    const cached = readHistoricalCloseCache(entry.ticker, entry.anchorDateIso, entry.mode);
    if (cached != null) continue;

    const list = byTicker.get(entry.ticker) ?? [];
    if (!list.some(item => item.anchorDateIso === entry.anchorDateIso && item.mode === entry.mode)) {
      list.push({ anchorDateIso: entry.anchorDateIso, mode: entry.mode });
    }
    byTicker.set(entry.ticker, list);
  }

  const map = new Map<string, number>();
  for (const entry of unique.values()) {
    const cached = readHistoricalCloseCache(entry.ticker, entry.anchorDateIso, entry.mode);
    if (cached != null) {
      map.set(`${entry.ticker}|${entry.anchorDateIso}|${entry.mode}`, cached);
    }
  }

  const tickerResults = await runPool([...byTicker.entries()], async ([ticker, dateRequests]) => {
    const resolved = await fetchNasdaqHistoricalClosesForTicker(ticker, dateRequests);
    return resolved.map(item => {
      const close = cacheHistoricalClose(ticker, item.anchorDateIso, item.mode, item.close);
      return { ticker, anchorDateIso: item.anchorDateIso, mode: item.mode, close };
    });
  });

  for (const batch of tickerResults) {
    for (const entry of batch) {
      if (entry.close != null) {
        map.set(`${entry.ticker}|${entry.anchorDateIso}|${entry.mode}`, entry.close);
      }
    }
  }

  return map;
};

export const fetchHistoricalCloseMap = async (
  tickers: string[],
  anchorDateIso: string,
  mode: HistoricalClosePickMode = 'on_or_after'
): Promise<Map<string, number>> => {
  const unique = [...new Set(tickers.map(t => normalizeTicker(t)).filter(Boolean))];
  return fetchHistoricalCloseMapByDate(
    unique.map(ticker => ({ ticker, anchorDateIso, mode }))
  ).then(map => {
    const byTicker = new Map<string, number>();
    for (const ticker of unique) {
      const close = map.get(`${ticker}|${anchorDateIso.trim()}|${mode}`);
      if (close != null) byTicker.set(ticker, close);
    }
    return byTicker;
  });
};

export const fetchUsQuoteMap = async (
  tickers: string[]
): Promise<Map<string, { price: number; status: 'ok' | 'missing' }>> => {
  const unique = [...new Set(tickers.map(t => normalizeTicker(t)).filter(Boolean))];
  const entries = await runPool(unique, async ticker => {
    try {
      const raw = await getQuotePrice({ ticker, exchange: 'NASDAQ' });
      const price = raw ? Number.parseFloat(raw) : Number.NaN;
      if (!Number.isFinite(price) || price <= 0) {
        return { ticker, price: 0, status: 'missing' as const };
      }
      return { ticker, price, status: 'ok' as const };
    } catch {
      return { ticker, price: 0, status: 'missing' as const };
    }
  });

  return new Map(entries.map(entry => [entry.ticker, { price: entry.price, status: entry.status }]));
};

export const computeReturnFromAnchor = (
  anchorPriceUsd: number,
  currentPriceUsd: number | null | undefined
): number | null => {
  if (!currentPriceUsd || !Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) {
    return null;
  }
  if (!Number.isFinite(anchorPriceUsd) || anchorPriceUsd <= 0) {
    return null;
  }
  return computeReturnPct(String(anchorPriceUsd), String(currentPriceUsd));
};

export const inferThirteenFReferencePrice = (
  currentMarketValueUsd: number | null | undefined,
  currentShares: number | null | undefined
): number | null => {
  if (!currentMarketValueUsd || !currentShares || currentShares <= 0) {
    return null;
  }
  const implied = currentMarketValueUsd / currentShares;
  return Number.isFinite(implied) && implied > 0 ? implied : null;
};

/** Reject historical quotes that diverge too far from 13F-implied quarter-end price. */
export const rejectOutlierHistoricalClose = (
  historicalClose: number | null,
  impliedReferencePriceUsd: number | null | undefined
): number | null => {
  if (historicalClose == null) return null;
  if (impliedReferencePriceUsd == null || impliedReferencePriceUsd <= 0) {
    return historicalClose;
  }
  const ratio = historicalClose / impliedReferencePriceUsd;
  if (ratio > 1.35 || ratio < 0.65) {
    return null;
  }
  return historicalClose;
};
