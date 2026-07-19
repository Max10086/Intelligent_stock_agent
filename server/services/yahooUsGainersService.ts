import type { ParsedGainerEntry, ParsedGainerPayload } from '../../types/marketGainers.ts';
import { getFinancialData } from '../../services/finance.ts';
import { parseTencentMarketCapToAbsolute } from '../../utils/priceFormat.ts';
import { getTradingDaysBefore } from '../../utils/tradingCalendar.ts';
import { getYahooFinanceSession, getYahooUserAgent, invalidateYahooFinanceSession } from '../lib/yahooCrumb.ts';
import {
  fetchUsDayGainersQuotesViaPython,
  fetchUsWeekGainersQuotesViaPython,
  shouldUseYahooPythonClient,
} from '../lib/yahooPythonClient.ts';
import { postYahooScreenerViaCurl, shouldUseYahooCurlClient } from '../lib/yahooCurlClient.ts';

const YAHOO_SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** NYSE / NASDAQ / AMEX listing codes returned by Yahoo screener. */
const US_LISTED_EXCHANGE_CODES = new Set(['NMS', 'NAS', 'NGM', 'NG', 'NCM', 'NYQ', 'NYS', 'ASE', 'PCX']);

export const readUsGainerMinMarketCap = (): number => {
  const raw = Number(process.env.GAINER_US_MIN_MCAP);
  return Number.isFinite(raw) && raw > 0 ? raw : 100_000_000;
};

export const readUsGainerMinDayVolume = (): number => {
  const raw = Number(process.env.GAINER_US_MIN_VOLUME);
  return Number.isFinite(raw) && raw > 0 ? raw : 50_000;
};

/** Per-sort-field Yahoo screener size when building the US weekly candidate pool. */
export const readUsWeeklyPoolSizePerSort = (): number => {
  const raw = Number(process.env.GAINER_US_WEEKLY_POOL_SIZE_PER_SORT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 250) : 250;
};

export const US_WEEKLY_POOL_SORT_FIELDS = ['percentchange', 'dayvolume', 'eodvolume'] as const;

export const readUsWeeklyPoolOffsets = (): number[] => {
  const raw = (process.env.GAINER_US_WEEKLY_POOL_OFFSETS || '').trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map(part => Number(part.trim()))
      .filter(value => Number.isFinite(value) && value >= 0);
    if (parsed.length > 0) return parsed;
  }
  return [0, 250, 500, 750, 1000];
};

/** Prior completed US session close used as weekly return baseline. */
export const resolveUsWeeklyBaselineDate = (tradingDateStart: string): string =>
  getTradingDaysBefore('US', tradingDateStart, 2)[0];

export const computeWeeklyChangePct = (baselineClose: number, endClose: number): number | null => {
  if (!Number.isFinite(baselineClose) || !Number.isFinite(endClose) || baselineClose <= 0 || endClose <= 0) {
    return null;
  }
  return Math.round(((endClose - baselineClose) / baselineClose) * 10000) / 100;
};

export const readQuoteMarketCap = (quote: Record<string, unknown>): number | null => {
  for (const key of ['intradaymarketcap', 'marketCap', 'market_cap']) {
    const value = Number(quote[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
};

export const passesUsGainerMarketCapQuote = (quote: Record<string, unknown>): boolean => {
  const cap = readQuoteMarketCap(quote);
  if (cap === null) return true;
  return cap >= readUsGainerMinMarketCap();
};

const passesUsGainerMarketCapProfile = async (entry: ParsedGainerEntry): Promise<boolean> => {
  try {
    const profile = await getFinancialData({
      name: entry.name,
      ticker: entry.ticker,
      exchange: entry.exchange || 'NASDAQ',
    });
    const cap = parseTencentMarketCapToAbsolute(profile.marketCap);
    if (cap === null) return false;
    return cap >= readUsGainerMinMarketCap();
  } catch {
    return false;
  }
};

const finalizeWeeklyEntriesWithMarketCap = async (
  ranked: Array<{ quote: Record<string, unknown>; weeklyPct: number }>,
  count: number
): Promise<ParsedGainerEntry[]> => {
  const entries: ParsedGainerEntry[] = [];
  let rank = 1;

  for (const row of ranked) {
    if (entries.length >= count) break;
    if (!passesUsGainerMarketCapQuote(row.quote)) continue;

    const entry = quoteToWeekEntry(row.quote, rank, row.weeklyPct);
    if (!entry) continue;
    if (!(await passesUsGainerMarketCapProfile(entry))) continue;

    entries.push({ ...entry, rank });
    rank += 1;
  }

  return entries;
};

const mapYahooExchange = (code?: string): string => {
  const ex = (code || '').toUpperCase();
  if (ex === 'NYQ' || ex === 'NYS' || ex === 'PCX') return 'NYSE';
  if (['NMS', 'NAS', 'NGM', 'NG', 'NCM'].includes(ex)) return 'NASDAQ';
  if (ex === 'ASE') return 'AMEX';
  return 'NASDAQ';
};

const buildUsExchangeOperand = () => ({
  operator: 'OR',
  operands: ['NMS', 'NYQ', 'NGM', 'NCM', 'ASE'].map(exchange => ({
    operator: 'EQ',
    operands: ['exchange', exchange],
  })),
});

const buildUsDayGainerScreenerQuery = () => ({
  operator: 'AND',
  operands: [
    { operator: 'GT', operands: ['percentchange', 0] },
    { operator: 'EQ', operands: ['region', 'us'] },
    { operator: 'GTE', operands: ['intradaymarketcap', readUsGainerMinMarketCap()] },
    { operator: 'GT', operands: ['dayvolume', readUsGainerMinDayVolume()] },
    buildUsExchangeOperand(),
  ],
});

const buildUsWeeklyPoolScreenerQuery = () => ({
  operator: 'AND',
  operands: [
    { operator: 'EQ', operands: ['region', 'us'] },
    { operator: 'GTE', operands: ['intradaymarketcap', readUsGainerMinMarketCap()] },
    { operator: 'GT', operands: ['dayvolume', readUsGainerMinDayVolume()] },
    buildUsExchangeOperand(),
  ],
});

const isLikelyWarrantOrUnit = (quote: Record<string, unknown>): boolean => {
  const symbol = String(quote.symbol || '').trim().toUpperCase();
  if (!symbol || symbol.includes('.') || symbol.includes('-')) return true;

  const name = `${quote.shortName || ''} ${quote.longName || ''}`.toLowerCase();
  if (/\bwarrant\b|\bunits?\b|\brights\b|\bdebenture\b/.test(name)) return true;

  if (symbol.length >= 5 && /(?:W|WS|WT|R)$/.test(symbol)) return true;

  return false;
};

const isUsListedEquityQuote = (quote: Record<string, unknown>): boolean => {
  const quoteType = String(quote.quoteType || '').toUpperCase();
  if (quoteType && quoteType !== 'EQUITY') return false;
  if (isLikelyWarrantOrUnit(quote)) return false;

  const exchange = String(quote.exchange || '').toUpperCase();
  if (exchange && !US_LISTED_EXCHANGE_CODES.has(exchange)) return false;

  return Boolean(String(quote.symbol || '').trim());
};

const isUsListedEquityDayGainer = (quote: Record<string, unknown>): boolean => {
  if (!isUsListedEquityQuote(quote)) return false;
  const changePct = Number(quote.regularMarketChangePercent);
  return Number.isFinite(changePct) && changePct > 0;
};

const quoteToDayEntry = (quote: Record<string, unknown>, rank: number): ParsedGainerEntry | null => {
  if (!isUsListedEquityDayGainer(quote)) return null;

  const ticker = String(quote.symbol || '').trim().toUpperCase();
  const name = String(quote.shortName || quote.longName || ticker).trim();
  const changePct = Number(quote.regularMarketChangePercent);

  return {
    rank,
    name,
    ticker,
    exchange: mapYahooExchange(String(quote.exchange || '')),
    changePct: Math.round(changePct * 100) / 100,
    blurb: name,
  };
};

const quoteToWeekEntry = (
  quote: Record<string, unknown>,
  rank: number,
  weeklyChangePct: number
): ParsedGainerEntry | null => {
  if (!isUsListedEquityQuote(quote)) return null;
  if (!Number.isFinite(weeklyChangePct) || weeklyChangePct <= 0) return null;

  const ticker = String(quote.symbol || '').trim().toUpperCase();
  const name = String(quote.shortName || quote.longName || ticker).trim();

  return {
    rank,
    name,
    ticker,
    exchange: mapYahooExchange(String(quote.exchange || '')),
    changePct: weeklyChangePct,
    blurb: name,
  };
};

const resolveAsOfDate = (quotes: Record<string, unknown>[], fallbackDate: string): string => {
  for (const quote of quotes) {
    const ts = Number(quote.regularMarketTime);
    if (Number.isFinite(ts) && ts > 0) {
      const iso = new Date(ts * 1000).toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
  }
  return fallbackDate;
};

export interface YahooDayGainersResult {
  payload: ParsedGainerPayload;
  rawResponse: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const mergeQuotesBySymbol = (quotes: Record<string, unknown>[]): Record<string, unknown>[] => {
  const map = new Map<string, Record<string, unknown>>();
  for (const quote of quotes) {
    const symbol = String(quote.symbol || '').trim().toUpperCase();
    if (symbol && !map.has(symbol)) map.set(symbol, quote);
  }
  return Array.from(map.values());
};

const postUsGainerScreener = async (params: {
  fetchCount: number;
  query: ReturnType<typeof buildUsDayGainerScreenerQuery> | ReturnType<typeof buildUsWeeklyPoolScreenerQuery>;
  sortField?: string;
  offset?: number;
}): Promise<{ rawResponse: unknown; quotes: Record<string, unknown>[] }> => {
  const screenerBody = {
    offset: params.offset ?? 0,
    size: params.fetchCount,
    sortField: params.sortField || 'percentchange',
    sortType: 'DESC',
    userId: '',
    userIdType: 'guid',
    quoteType: 'EQUITY',
    query: params.query,
  };

  const baseUrl = `${YAHOO_SCREENER_URL}?corsDomain=finance.yahoo.com&formatted=false&lang=en-US&region=US`;
  const bodyJson = JSON.stringify(screenerBody);

  let bodyText: string;

  if (shouldUseYahooCurlClient()) {
    const curlRes = await postYahooScreenerViaCurl({ url: baseUrl, body: bodyJson });
    bodyText = curlRes.body;
  } else {
    const { cookie, crumb } = await getYahooFinanceSession();
    const url = `${baseUrl}&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': getYahooUserAgent(),
        Cookie: cookie,
      },
      body: bodyJson,
    });

    bodyText = await res.text();
    if (!res.ok) {
      throw new Error(
        `Yahoo US gainer screener failed (${res.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`
      );
    }
  }

  const rawResponse = JSON.parse(bodyText) as {
    finance?: { result?: unknown[]; error?: { description?: string } };
  };
  const financeError = rawResponse.finance?.error;
  if (financeError) {
    throw new Error(`Yahoo US gainer screener error: ${financeError.description || 'unknown'}`);
  }

  const first = Array.isArray(rawResponse.finance?.result) ? rawResponse.finance.result[0] : null;
  const quotesRaw = first && typeof first === 'object' ? (first as { quotes?: unknown[] }).quotes : null;
  const quotes = Array.isArray(quotesRaw)
    ? quotesRaw.filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === 'object')
    : [];

  return { rawResponse, quotes };
};

const isoToUnixStart = (isoDate: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
};

const isoToUnixEnd = (isoDate: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day + 1, 0, 0, 0) / 1000) - 1;
};

const closeOnOrBefore = (timestamps: number[], closes: Array<number | null>, targetIso: string): number | null => {
  const target = isoToUnixEnd(targetIso);
  let best: number | null = null;
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    const close = closes[i];
    if (!Number.isFinite(ts) || close === null || !Number.isFinite(close) || close <= 0) continue;
    if (ts <= target) best = close;
  }
  return best;
};

const fetchWeeklyChangePctForSymbol = async (
  symbol: string,
  baselineDate: string,
  tradingDateEnd: string
): Promise<number | null> => {
  const period1 = isoToUnixStart(baselineDate) - 7 * 24 * 3600;
  const period2 = isoToUnixEnd(tradingDateEnd) + 3 * 24 * 3600;
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;

  try {
    const { cookie, crumb } = await getYahooFinanceSession();
    const res = await fetch(`${url}&crumb=${encodeURIComponent(crumb)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': getYahooUserAgent(),
        Cookie: cookie,
      },
    });
    const bodyText = await res.text();
    if (!res.ok) return null;

    const json = JSON.parse(bodyText) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const baselineClose = closeOnOrBefore(timestamps, closes, baselineDate);
    const endClose = closeOnOrBefore(timestamps, closes, tradingDateEnd);
    if (baselineClose === null || endClose === null) return null;
    return computeWeeklyChangePct(baselineClose, endClose);
  } catch {
    return null;
  }
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
};

const buildWeeklyEntriesFromQuotes = async (params: {
  quotes: Record<string, unknown>[];
  baselineDate: string;
  tradingDateEnd: string;
  count: number;
}): Promise<ParsedGainerEntry[]> => {
  const eligible = params.quotes.filter(
    quote => isUsListedEquityQuote(quote) && passesUsGainerMarketCapQuote(quote)
  );
  const weeklyChanges = await mapWithConcurrency(eligible, 8, async quote => {
    const symbol = String(quote.symbol || '').trim().toUpperCase();
    const weeklyPct = Number(quote.weeklyChangePercent);
    if (Number.isFinite(weeklyPct) && weeklyPct > 0) {
      return { quote, weeklyPct };
    }
    const computed = await fetchWeeklyChangePctForSymbol(
      symbol,
      params.baselineDate,
      params.tradingDateEnd
    );
    return computed === null ? null : { quote, weeklyPct: computed };
  });

  const ranked = weeklyChanges
    .filter((row): row is { quote: Record<string, unknown>; weeklyPct: number } => Boolean(row))
    .sort((a, b) => b.weeklyPct - a.weeklyPct);

  return finalizeWeeklyEntriesWithMarketCap(ranked, params.count);
};

const fetchUsWeeklyCandidatePool = async (): Promise<{
  quotes: Record<string, unknown>[];
  rawResponse: unknown;
}> => {
  const poolSizePerSort = readUsWeeklyPoolSizePerSort();
  const poolOffsets = readUsWeeklyPoolOffsets();
  const query = buildUsWeeklyPoolScreenerQuery();

  const pools = await Promise.all(
    US_WEEKLY_POOL_SORT_FIELDS.flatMap(sortField =>
      poolOffsets.map(offset =>
        postUsGainerScreener({ fetchCount: poolSizePerSort, query, sortField, offset })
      )
    )
  );

  return {
    quotes: mergeQuotesBySymbol(pools.flatMap(pool => pool.quotes)),
    rawResponse: {
      source: 'yahoo',
      mode: 'weekly_pool',
      sortFields: US_WEEKLY_POOL_SORT_FIELDS,
      poolSizePerSort,
      poolOffsets,
      pools: pools.map(pool => pool.rawResponse),
    },
  };
};

/** Fetch US day gainers via Yahoo custom screener sorted by percent change. */
export const fetchUsDayGainersFromYahoo = async (params: {
  tradingDateEnd: string;
  count?: number;
}): Promise<YahooDayGainersResult> => {
  const count = params.count ?? 20;
  const fetchCount = Math.min(80, count + 25);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let rawResponse: unknown;
      let quotes: Record<string, unknown>[];

      if (shouldUseYahooPythonClient()) {
        const python = await fetchUsDayGainersQuotesViaPython({
          size: fetchCount,
          minMarketCap: readUsGainerMinMarketCap(),
          minDayVolume: readUsGainerMinDayVolume(),
        });
        rawResponse = python.rawResponse;
        quotes = python.quotes;
      } else {
        const screener = await postUsGainerScreener({
          fetchCount,
          query: buildUsDayGainerScreenerQuery(),
        });
        rawResponse = screener.rawResponse;
        quotes = screener.quotes;
      }

      if (quotes.length === 0) {
        throw new Error('Yahoo US day-gainer screener returned no quotes');
      }

      const entries: ParsedGainerEntry[] = [];
      for (const quote of quotes) {
        const entry = quoteToDayEntry(quote, entries.length + 1);
        if (entry) entries.push(entry);
        if (entries.length >= count) break;
      }

      if (entries.length === 0) {
        throw new Error('Yahoo US day-gainer screener returned no valid US equity quotes');
      }

      return {
        payload: {
          asOfDate: resolveAsOfDate(quotes, params.tradingDateEnd),
          entries,
        },
        rawResponse,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = /429|too many requests/i.test(message);
      if (!isRateLimited || attempt === 3) break;
      invalidateYahooFinanceSession();
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

/** Fetch US weekly gainers: same mcap/volume/exchange filters as daily, ranked by weekly return. */
export const fetchUsWeekGainersFromYahoo = async (params: {
  tradingDateEnd: string;
  tradingDateStart: string;
  count?: number;
}): Promise<YahooDayGainersResult> => {
  const count = params.count ?? 20;
  const poolSizePerSort = readUsWeeklyPoolSizePerSort();
  const baselineDate = resolveUsWeeklyBaselineDate(params.tradingDateStart);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let rawResponse: unknown;
      let quotes: Record<string, unknown>[];

      if (shouldUseYahooPythonClient()) {
        const python = await fetchUsWeekGainersQuotesViaPython({
          poolSizePerSort,
          poolOffsets: readUsWeeklyPoolOffsets(),
          count,
          minMarketCap: readUsGainerMinMarketCap(),
          minDayVolume: readUsGainerMinDayVolume(),
          baselineDate,
          tradingDateEnd: params.tradingDateEnd,
        });
        rawResponse = python.rawResponse;
        quotes = python.quotes;
      } else {
        const pool = await fetchUsWeeklyCandidatePool();
        rawResponse = pool.rawResponse;
        quotes = pool.quotes;
      }

      if (quotes.length === 0) {
        throw new Error('Yahoo US weekly-gainer screener returned no quotes');
      }

      const precomputed = quotes.every(quote => Number.isFinite(Number(quote.weeklyChangePercent)));
      const entries = precomputed
        ? await finalizeWeeklyEntriesWithMarketCap(
            quotes
              .map(quote => ({
                quote,
                weeklyPct: Number(quote.weeklyChangePercent),
              }))
              .filter(row => Number.isFinite(row.weeklyPct) && row.weeklyPct > 0)
              .sort((a, b) => b.weeklyPct - a.weeklyPct),
            count
          )
        : await buildWeeklyEntriesFromQuotes({
            quotes,
            baselineDate,
            tradingDateEnd: params.tradingDateEnd,
            count,
          });

      if (entries.length === 0) {
        throw new Error('Yahoo US weekly-gainer screener returned no valid weekly movers');
      }

      return {
        payload: {
          asOfDate: params.tradingDateEnd,
          periodStart: params.tradingDateStart,
          entries,
        },
        rawResponse,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = /429|too many requests/i.test(message);
      if (!isRateLimited || attempt === 3) break;
      invalidateYahooFinanceSession();
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
