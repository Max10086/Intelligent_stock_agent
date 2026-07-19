import type { GainerMarket, GainerPeriod } from '../../types/marketGainers.js';
import { GainerMarket as PrismaGainerMarket, GainerPeriod as PrismaGainerPeriod } from '@prisma/client';
import { prisma, withPrismaRetry } from '../db.js';
import { getGainerModelConfig, getGainerUsBlurbConfig, getGainerUsDailySource, getRuntimeModelConfig, DOUBAO_CUSTOM_API_KEY, DOUBAO_SEARCH_API_KEY } from '../aiModelConfig.js';
import { ModelClient } from './modelClient.js';
import { buildMarketGainersPrompt } from '../../utils/marketGainersPrompt.js';
import { buildUsGainerBlurbPrompt } from '../../utils/marketGainersBlurbPrompt.js';
import { parseGainerBlurbsResponse, parseMarketGainersResponse, resolveGainerBadge } from '../../utils/marketGainersParse.js';
import { fetchUsDayGainersFromYahoo, fetchUsWeekGainersFromYahoo } from './yahooUsGainersService.js';
import {
  getFirstTradingDayOfWeek,
  getLastCompletedTradingDay,
  getLastTradingDayOfWeek,
  getTradingDaysBefore,
} from '../../utils/tradingCalendar.js';
import { getQuoteDayChangePct, searchTicker } from '../../services/finance.js';
import type {
  MarketGainerEntryDto,
  MarketGainerListResponse,
  MarketGainerSnapshotDto,
  ParsedGainerEntry,
  ParsedGainerPayload,
  UserGainerPreferenceDto,
} from '../../types/marketGainers.js';

const APPEARANCE_WINDOW_DAYS = 14;

const toPrismaMarket = (market: GainerMarket): PrismaGainerMarket => {
  if (market === 'CN') return 'CN';
  if (market === 'HK') return 'HK';
  return 'US';
};

const toPrismaPeriod = (period: GainerPeriod): PrismaGainerPeriod => {
  if (period === 'WEEKLY') return 'WEEKLY';
  if (period === 'THREE_DAY') return 'THREE_DAY';
  return 'DAILY';
};

const fromPrismaMarket = (market: PrismaGainerMarket): GainerMarket => market as GainerMarket;
const fromPrismaPeriod = (period: PrismaGainerPeriod): GainerPeriod => period as GainerPeriod;

export const resolveGainerWindow = (
  market: GainerMarket,
  period: GainerPeriod,
  now = new Date()
): { tradingDateEnd: string; tradingDateStart?: string } => {
  if (period === 'DAILY') {
    return { tradingDateEnd: getLastCompletedTradingDay(market, now) };
  }
  if (period === 'THREE_DAY') {
    const end = getLastCompletedTradingDay(market, now);
    const days = getTradingDaysBefore(market, end, 3);
    return { tradingDateEnd: end, tradingDateStart: days[0] };
  }
  const weekEnd = getLastTradingDayOfWeek(market, now);
  return {
    tradingDateEnd: weekEnd,
    tradingDateStart: getFirstTradingDayOfWeek(market, weekEnd),
  };
};

const resolveQuoteExchange = (
  ticker: string,
  exchange?: string | null
): string => {
  const normalized = (exchange || 'NASDAQ').toUpperCase();
  if (['NASDAQ', 'NYSE', 'AMEX', 'US', 'SSE', 'SZSE', 'HKEX', 'HK'].includes(normalized)) {
    return normalized === 'US' ? 'NASDAQ' : normalized;
  }
  return /^[0-9]{6}$/.test(ticker) ? 'SSE' : 'NASDAQ';
};

const validateEntryQuote = async (
  entry: {
    ticker: string;
    exchange?: string | null;
    changePct: number;
  },
  period: GainerPeriod
): Promise<boolean> => {
  try {
    if (period !== 'DAILY') {
      const found = await searchTicker(entry.ticker);
      return Boolean(found);
    }

    let exchange = resolveQuoteExchange(entry.ticker, entry.exchange);
    let quotedPct = await getQuoteDayChangePct({ ticker: entry.ticker, exchange });

    if (quotedPct === null) {
      const found = await searchTicker(entry.ticker);
      if (!found) return false;
      exchange = found.exchange;
      quotedPct = await getQuoteDayChangePct({ ticker: entry.ticker, exchange });
    }

    if (quotedPct === null) return true;
    return Math.abs(quotedPct - entry.changePct) <= 3;
  } catch {
    return false;
  }
};

const fetchGainersFromModel = async (
  modelClient: ModelClient,
  market: GainerMarket,
  period: GainerPeriod,
  tradingDateEnd: string,
  tradingDateStart?: string
) => {
  const config = getGainerModelConfig();
  const prompt = buildMarketGainersPrompt({
    market,
    period,
    tradingDateEnd,
    tradingDateStart,
  });
  const provider = market === 'US' ? config.us.provider : config.cn.provider;
  const model = market === 'US' ? config.us.model : config.cn.model;
  const step = market === 'US' ? 'market_gainer_fetch_us' : 'market_gainer_fetch_cn';

  console.info('[gainers] calling model', {
    market,
    period,
    step,
    provider,
    model,
    cnUseSearch: market === 'CN' ? config.cn.useSearch : undefined,
  });

  if (market === 'US') {
    const useGoogleSearch = config.us.provider === 'vertex' && config.us.useGoogleSearch;
    const vertexConfig: Record<string, unknown> = { responseMimeType: 'application/json' };
    if (useGoogleSearch) {
      vertexConfig.tools = [{ googleSearch: {} }];
    }

    const response = await modelClient.generateContent({
      step: 'market_gainer_fetch_us',
      provider: config.us.provider,
      model: config.us.model,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: vertexConfig,
      requireGoogleSearch: false,
    });
    return response.text || '';
  }

  if (market === 'CN') {
    const runtime = getRuntimeModelConfig();
    const useSearch =
      config.cn.useSearch &&
      runtime.search.provider === 'doubao' &&
      Boolean((DOUBAO_CUSTOM_API_KEY || DOUBAO_SEARCH_API_KEY).trim());

    if (useSearch) {
      const response = await modelClient.generateContent({
        step: 'market_gainer_fetch_cn',
        provider: 'doubao',
        model: runtime.search.model,
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' },
      });
      return response.text || '';
    }

    const response = await modelClient.generateContent({
      step: 'market_gainer_fetch_cn',
      provider: 'deepseek',
      model: config.cn.model,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: { responseMimeType: 'application/json' },
    });
    return response.text || '';
  }

  throw new Error(`Gainer fetch not implemented for market ${market}`);
};

const usesYahooUsGainers = (market: GainerMarket, period: GainerPeriod): boolean =>
  market === 'US' && getGainerUsDailySource() === 'yahoo' && (period === 'DAILY' || period === 'WEEKLY');

const resolveSnapshotModelMeta = (
  market: GainerMarket,
  period: GainerPeriod
): { modelProvider: string; modelName: string } => {
  if (usesYahooUsGainers(market, period)) {
    return period === 'WEEKLY'
      ? { modelProvider: 'yahoo', modelName: 'weekly_percentchange' }
      : { modelProvider: 'yahoo', modelName: 'top_percentchange' };
  }
  const config = getGainerModelConfig();
  if (market === 'US') {
    return { modelProvider: config.us.provider, modelName: config.us.model };
  }
  return { modelProvider: config.cn.provider, modelName: config.cn.model };
};

const enrichUsGainerBlurbs = async (
  modelClient: ModelClient,
  entries: ParsedGainerEntry[],
  tradingDateEnd: string
): Promise<ParsedGainerEntry[]> => {
  if (entries.length === 0) return entries;

  const blurbConfig = getGainerUsBlurbConfig();
  const prompt = buildUsGainerBlurbPrompt({ tradingDateEnd, entries });

  try {
    const response = await modelClient.generateContent({
      step: 'market_gainer_blurb_us',
      provider: blurbConfig.provider,
      model: blurbConfig.model,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: { responseMimeType: 'application/json' },
    });
    const blurbs = parseGainerBlurbsResponse(response.text || '');
    return entries.map(entry => ({
      ...entry,
      blurb: blurbs.get(entry.ticker.toUpperCase()) || entry.blurb,
    }));
  } catch (error) {
    console.warn(
      '[gainers] US blurb enrichment failed; using company names as blurbs',
      error instanceof Error ? error.message : error
    );
    return entries;
  }
};

const fetchGainersPayload = async (
  modelClient: ModelClient,
  market: GainerMarket,
  period: GainerPeriod,
  tradingDateEnd: string,
  tradingDateStart?: string
): Promise<{ parsed: ParsedGainerPayload; rawResponse: string }> => {
  if (usesYahooUsGainers(market, period) && period === 'DAILY') {
    console.info('[gainers] fetching US daily gainers from Yahoo percentchange screener');
    const yahoo = await fetchUsDayGainersFromYahoo({ tradingDateEnd });
    const entries = await enrichUsGainerBlurbs(
      modelClient,
      yahoo.payload.entries,
      tradingDateEnd
    );
    return {
      parsed: { ...yahoo.payload, entries },
      rawResponse: JSON.stringify(yahoo.rawResponse),
    };
  }

  if (usesYahooUsGainers(market, period) && period === 'WEEKLY') {
    if (!tradingDateStart) {
      throw new Error('US weekly Yahoo fetch requires tradingDateStart');
    }
    console.info('[gainers] fetching US weekly gainers from Yahoo screener + weekly return ranking', {
      tradingDateStart,
      tradingDateEnd,
    });
    const yahoo = await fetchUsWeekGainersFromYahoo({
      tradingDateEnd,
      tradingDateStart,
    });
    const entries = await enrichUsGainerBlurbs(
      modelClient,
      yahoo.payload.entries,
      tradingDateEnd
    );
    return {
      parsed: { ...yahoo.payload, entries },
      rawResponse: JSON.stringify(yahoo.rawResponse),
    };
  }

  const rawResponse = await fetchGainersFromModel(
    modelClient,
    market,
    period,
    tradingDateEnd,
    tradingDateStart
  );
  return {
    parsed: parseMarketGainersResponse(rawResponse),
    rawResponse,
  };
};

export const refreshMarketGainers = async (params: {
  market: GainerMarket;
  period: GainerPeriod;
  modelClient: ModelClient;
  force?: boolean;
  /** When false (default), skip quote/ticker validation for faster fetch. */
  validateQuotes?: boolean;
}): Promise<{ snapshotId: string; status: string; entryCount?: number }> => {
  const { market, period, modelClient, validateQuotes = false } = params;
  if (market === 'HK') {
    throw new Error('HK gainer fetch is reserved for a future release');
  }

  const window = resolveGainerWindow(market, period);
  const { modelProvider, modelName } = resolveSnapshotModelMeta(market, period);

  const existing = await withPrismaRetry(
    () =>
      prisma.marketGainerSnapshot.findUnique({
        where: {
          market_period_tradingDateEnd: {
            market: toPrismaMarket(market),
            period: toPrismaPeriod(period),
            tradingDateEnd: window.tradingDateEnd,
          },
        },
      }),
    'gainers.snapshotLookup',
    2
  );

  if (existing?.status === 'COMPLETED' && !params.force) {
    return { snapshotId: existing.id, status: existing.status };
  }

  const snapshot = existing
    ? await withPrismaRetry(
        () =>
          prisma.marketGainerSnapshot.update({
            where: { id: existing.id },
            data: {
              status: 'PENDING',
              error: null,
              tradingDateStart: window.tradingDateStart || null,
              modelProvider,
              modelName,
            },
          }),
        'gainers.snapshotReset',
        2
      )
    : await withPrismaRetry(
        () =>
          prisma.marketGainerSnapshot.create({
            data: {
              market: toPrismaMarket(market),
              period: toPrismaPeriod(period),
              tradingDateEnd: window.tradingDateEnd,
              tradingDateStart: window.tradingDateStart || null,
              modelProvider,
              modelName,
              status: 'PENDING',
            },
          }),
        'gainers.snapshotCreate',
        2
      );

  try {
    console.info('[gainers] fetch start', {
      market,
      period,
      tradingDateEnd: window.tradingDateEnd,
      tradingDateStart: window.tradingDateStart ?? null,
      provider: modelProvider,
      model: modelName,
      validateQuotes,
      force: params.force ?? false,
    });

    const { parsed, rawResponse } = await fetchGainersPayload(
      modelClient,
      market,
      period,
      window.tradingDateEnd,
      window.tradingDateStart
    );
    console.info('[gainers] payload received', {
      market,
      period,
      entryCount: parsed.entries.length,
      source: usesYahooUsGainers(market, period) ? 'yahoo' : 'model',
    });
    if (parsed.asOfDate && parsed.asOfDate !== window.tradingDateEnd) {
      console.warn('[gainers] model asOfDate mismatch; keeping computed session date', {
        market,
        period,
        expected: window.tradingDateEnd,
        modelAsOfDate: parsed.asOfDate,
      });
    }

    await withPrismaRetry(
      () => prisma.marketGainerEntry.deleteMany({ where: { snapshotId: snapshot.id } }),
      'gainers.entriesClear',
      2
    );

    const entries = await Promise.all(
      parsed.entries.map(async entry => {
        const validated = validateQuotes ? await validateEntryQuote(entry, period) : false;
        return withPrismaRetry(
          () =>
            prisma.marketGainerEntry.create({
              data: {
                snapshotId: snapshot.id,
                rank: entry.rank,
                name: entry.name,
                ticker: entry.ticker,
                exchange: entry.exchange || null,
                changePct: entry.changePct,
                blurb: entry.blurb,
                validated,
              },
            }),
          'gainers.entryCreate',
          2
        );
      })
    );

    await withPrismaRetry(
      () =>
        prisma.marketGainerSnapshot.update({
          where: { id: snapshot.id },
          data: {
            status: 'COMPLETED',
            error: null,
            rawResponse,
            tradingDateEnd: window.tradingDateEnd,
            tradingDateStart: window.tradingDateStart || null,
          },
        }),
      'gainers.snapshotComplete',
      2
    );

    await recomputeGainerAppearances(market);

    return { snapshotId: snapshot.id, status: 'COMPLETED', entryCount: entries.length };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await withPrismaRetry(
      () =>
        prisma.marketGainerSnapshot.update({
          where: { id: snapshot.id },
          data: { status: 'FAILED', error: message },
        }),
      'gainers.snapshotFail',
      2
    );
    throw error;
  }
};

export const recomputeGainerAppearances = async (market: GainerMarket) => {
  const since = new Date(Date.now() - APPEARANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const prismaMarket = toPrismaMarket(market);

  const snapshots = await withPrismaRetry(
    () =>
      prisma.marketGainerSnapshot.findMany({
        where: {
          market: prismaMarket,
          status: 'COMPLETED',
          fetchedAt: { gte: since },
        },
        include: { entries: true },
      }),
    'gainers.appearanceSnapshots',
    2
  );

  const tickerMap = new Map<
    string,
    {
      name: string;
      dailyDates: Set<string>;
      weeklyDates: Set<string>;
      lastSeenAt: Date;
      firstSeenAt: Date;
    }
  >();

  for (const snapshot of snapshots) {
    const countsTowardDaily =
      snapshot.period === 'DAILY' || snapshot.period === 'THREE_DAY';
    for (const entry of snapshot.entries) {
      const key = entry.ticker.toUpperCase();
      const existing = tickerMap.get(key) || {
        name: entry.name,
        dailyDates: new Set<string>(),
        weeklyDates: new Set<string>(),
        lastSeenAt: snapshot.fetchedAt,
        firstSeenAt: snapshot.fetchedAt,
      };
      existing.name = entry.name;
      if (snapshot.fetchedAt > existing.lastSeenAt) existing.lastSeenAt = snapshot.fetchedAt;
      if (snapshot.fetchedAt < existing.firstSeenAt) existing.firstSeenAt = snapshot.fetchedAt;
      if (countsTowardDaily) existing.dailyDates.add(snapshot.tradingDateEnd);
      if (snapshot.period === 'WEEKLY') existing.weeklyDates.add(snapshot.tradingDateEnd);
      tickerMap.set(key, existing);
    }
  }

  for (const [ticker, stats] of tickerMap.entries()) {
    const dailyAppearances14d = stats.dailyDates.size;
    const weeklyAppearances14d = stats.weeklyDates.size;
    let appearanceScore = dailyAppearances14d + weeklyAppearances14d * 2;
    if (dailyAppearances14d >= 2) appearanceScore += 1;
    if (dailyAppearances14d >= 3) appearanceScore += 2;

    const autoAnalyzeEligible = dailyAppearances14d >= 2;

    await withPrismaRetry(
      () =>
        prisma.marketGainerAppearance.upsert({
          where: {
            market_ticker: {
              market: prismaMarket,
              ticker,
            },
          },
          create: {
            market: prismaMarket,
            ticker,
            name: stats.name,
            appearanceScore,
            dailyAppearances14d,
            weeklyAppearances14d,
            lastSeenAt: stats.lastSeenAt,
            firstSeenAt: stats.firstSeenAt,
            autoAnalyzeEligible,
          },
          update: {
            name: stats.name,
            appearanceScore,
            dailyAppearances14d,
            weeklyAppearances14d,
            lastSeenAt: stats.lastSeenAt,
            autoAnalyzeEligible,
          },
        }),
      'gainers.appearanceUpsert',
      2
    );
  }
};

const mapEntryDto = (
  entry: {
    id: string;
    rank: number;
    name: string;
    ticker: string;
    exchange: string | null;
    changePct: number;
    blurb: string;
    validated: boolean;
  },
  appearance?: {
    appearanceScore: number;
    dailyAppearances14d: number;
    weeklyAppearances14d: number;
    autoAnalyzeEligible: boolean;
  } | null,
  displayRank = entry.rank
): MarketGainerEntryDto => {
  const appearanceScore = appearance?.appearanceScore ?? 0;
  const dailyAppearances14d = appearance?.dailyAppearances14d ?? 0;
  const weeklyAppearances14d = appearance?.weeklyAppearances14d ?? 0;

  return {
    id: entry.id,
    rank: entry.rank,
    displayRank,
    name: entry.name,
    ticker: entry.ticker,
    exchange: entry.exchange,
    changePct: entry.changePct,
    blurb: entry.blurb,
    validated: entry.validated,
    appearanceScore,
    dailyAppearances14d,
    weeklyAppearances14d,
    badge: resolveGainerBadge({ appearanceScore, dailyAppearances14d }),
    autoAnalyzeEligible: appearance?.autoAnalyzeEligible ?? false,
  };
};

const mapSnapshotDto = async (
  snapshot: Awaited<ReturnType<typeof loadLatestSnapshot>>
): Promise<MarketGainerSnapshotDto | null> => {
  if (!snapshot) return null;

  const appearances = await withPrismaRetry(
    () =>
      prisma.marketGainerAppearance.findMany({
        where: {
          market: snapshot.market,
          ticker: { in: snapshot.entries.map(entry => entry.ticker.toUpperCase()) },
        },
      }),
    'gainers.appearanceLookup',
    2
  );
  const appearanceMap = new Map(appearances.map(row => [row.ticker.toUpperCase(), row]));

  const entries = snapshot.entries
    .map(entry => mapEntryDto(entry, appearanceMap.get(entry.ticker.toUpperCase()) || null))
    .sort((a, b) => {
      if (b.appearanceScore !== a.appearanceScore) return b.appearanceScore - a.appearanceScore;
      if (b.changePct !== a.changePct) return b.changePct - a.changePct;
      return a.rank - b.rank;
    })
    .map((entry, index) => ({ ...entry, displayRank: index + 1 }));

  return {
    id: snapshot.id,
    market: fromPrismaMarket(snapshot.market),
    period: fromPrismaPeriod(snapshot.period),
    tradingDateEnd: snapshot.tradingDateEnd,
    tradingDateStart: snapshot.tradingDateStart,
    modelProvider: snapshot.modelProvider,
    modelName: snapshot.modelName,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    entries,
  };
};

const loadLatestSnapshot = async (market: GainerMarket, period: GainerPeriod) =>
  withPrismaRetry(
    () =>
      prisma.marketGainerSnapshot.findFirst({
        where: {
          market: toPrismaMarket(market),
          period: toPrismaPeriod(period),
          status: 'COMPLETED',
        },
        orderBy: { tradingDateEnd: 'desc' },
        include: { entries: { orderBy: { rank: 'asc' } } },
      }),
    'gainers.latestSnapshot',
    2
  );

const loadSnapshotByTradingDate = async (
  market: GainerMarket,
  period: GainerPeriod,
  tradingDateEnd: string
) =>
  withPrismaRetry(
    () =>
      prisma.marketGainerSnapshot.findUnique({
        where: {
          market_period_tradingDateEnd: {
            market: toPrismaMarket(market),
            period: toPrismaPeriod(period),
            tradingDateEnd,
          },
        },
        include: { entries: { orderBy: { rank: 'asc' } } },
      }),
    'gainers.snapshotByDate',
    2
  );

const TRADING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const getMarketGainerSnapshotHistory = async (
  market: GainerMarket,
  period: GainerPeriod,
  limit = 60
) => {
  const rows = await withPrismaRetry(
    () =>
      prisma.marketGainerSnapshot.findMany({
        where: {
          market: toPrismaMarket(market),
          period: toPrismaPeriod(period),
          status: 'COMPLETED',
        },
        orderBy: { tradingDateEnd: 'desc' },
        take: Math.min(Math.max(limit, 1), 120),
        select: {
          id: true,
          tradingDateEnd: true,
          tradingDateStart: true,
          fetchedAt: true,
          modelProvider: true,
          modelName: true,
          _count: { select: { entries: true } },
        },
      }),
    'gainers.snapshotHistory',
    2
  );

  return rows.map(row => ({
    id: row.id,
    tradingDateEnd: row.tradingDateEnd,
    tradingDateStart: row.tradingDateStart,
    fetchedAt: row.fetchedAt.toISOString(),
    entryCount: row._count.entries,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
  }));
};

export const getMarketGainerList = async (
  market: GainerMarket,
  period: GainerPeriod,
  tradingDateEnd?: string | null
): Promise<MarketGainerListResponse> => {
  const normalizedDate =
    tradingDateEnd && TRADING_DATE_PATTERN.test(tradingDateEnd.trim())
      ? tradingDateEnd.trim()
      : null;

  const snapshotRow = normalizedDate
    ? await loadSnapshotByTradingDate(market, period, normalizedDate)
    : await loadLatestSnapshot(market, period);

  const completedSnapshot =
    snapshotRow?.status === 'COMPLETED' ? snapshotRow : null;
  const snapshot = await mapSnapshotDto(completedSnapshot);

  const highAttentionRows = await withPrismaRetry(
    () =>
      prisma.marketGainerAppearance.findMany({
        where: {
          market: toPrismaMarket(market),
          appearanceScore: { gte: 2 },
        },
        orderBy: [{ appearanceScore: 'desc' }, { lastSeenAt: 'desc' }],
        take: 20,
      }),
    'gainers.highAttention',
    2
  );

  const entryByTicker = new Map(
    (completedSnapshot?.entries || []).map(entry => [entry.ticker.toUpperCase(), entry])
  );

  const highAttention: MarketGainerEntryDto[] = highAttentionRows
    .map(row => {
      const entry = entryByTicker.get(row.ticker.toUpperCase());
      if (entry) {
        return mapEntryDto(entry, row);
      }
      return {
        id: `appearance-${row.id}`,
        rank: 999,
        displayRank: 999,
        name: row.name,
        ticker: row.ticker,
        exchange: null,
        changePct: 0,
        blurb: '',
        validated: false,
        appearanceScore: row.appearanceScore,
        dailyAppearances14d: row.dailyAppearances14d,
        weeklyAppearances14d: row.weeklyAppearances14d,
        badge: resolveGainerBadge({
          appearanceScore: row.appearanceScore,
          dailyAppearances14d: row.dailyAppearances14d,
        }),
        autoAnalyzeEligible: row.autoAnalyzeEligible,
      };
    })
    .sort((a, b) => b.appearanceScore - a.appearanceScore)
    .slice(0, 10);

  return { snapshot, highAttention, selectedTradingDateEnd: normalizedDate };
};

export const parseGainerPreferenceMarkets = (raw: string): GainerMarket[] =>
  raw
    .split(',')
    .map(part => part.trim().toUpperCase())
    .filter((part): part is GainerMarket => part === 'US' || part === 'CN' || part === 'HK');

export const getUserGainerPreference = async (
  userId: string
): Promise<UserGainerPreferenceDto> => {
  const row = await withPrismaRetry(
    () => prisma.userGainerPreference.findUnique({ where: { userId } }),
    'gainers.prefGet',
    2
  );

  if (!row) {
    return {
      autoAnalyzeEnabled: false,
      autoAnalyzeMarkets: ['US', 'CN'],
      minAppearanceScore: 2,
      maxAutoTickersPerRun: 5,
      language: 'cn',
    };
  }

  return {
    autoAnalyzeEnabled: row.autoAnalyzeEnabled,
    autoAnalyzeMarkets: parseGainerPreferenceMarkets(row.autoAnalyzeMarkets),
    minAppearanceScore: row.minAppearanceScore,
    maxAutoTickersPerRun: row.maxAutoTickersPerRun,
    language: row.language === 'en' ? 'en' : 'cn',
  };
};

export const updateUserGainerPreference = async (
  userId: string,
  patch: Partial<UserGainerPreferenceDto>
): Promise<UserGainerPreferenceDto> => {
  const current = await getUserGainerPreference(userId);
  const next: UserGainerPreferenceDto = {
    ...current,
    ...patch,
    autoAnalyzeMarkets: patch.autoAnalyzeMarkets || current.autoAnalyzeMarkets,
  };

  await withPrismaRetry(
    () =>
      prisma.userGainerPreference.upsert({
        where: { userId },
        create: {
          userId,
          autoAnalyzeEnabled: next.autoAnalyzeEnabled,
          autoAnalyzeMarkets: next.autoAnalyzeMarkets.join(','),
          minAppearanceScore: next.minAppearanceScore,
          maxAutoTickersPerRun: next.maxAutoTickersPerRun,
          language: next.language,
        },
        update: {
          autoAnalyzeEnabled: next.autoAnalyzeEnabled,
          autoAnalyzeMarkets: next.autoAnalyzeMarkets.join(','),
          minAppearanceScore: next.minAppearanceScore,
          maxAutoTickersPerRun: next.maxAutoTickersPerRun,
          language: next.language,
        },
      }),
    'gainers.prefUpsert',
    2
  );

  return next;
};

export const listAutoAnalyzeEligibleTickers = async (
  market: GainerMarket,
  limit: number
): Promise<Array<{ ticker: string; name: string; appearanceScore: number }>> => {
  const rows = await withPrismaRetry(
    () =>
      prisma.marketGainerAppearance.findMany({
        where: {
          market: toPrismaMarket(market),
          autoAnalyzeEligible: true,
          OR: [{ autoAnalyzeTriggeredAt: null }, { autoAnalyzeTriggeredAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }],
        },
        orderBy: [{ appearanceScore: 'desc' }, { lastSeenAt: 'desc' }],
        take: limit,
      }),
    'gainers.autoEligible',
    2
  );

  return rows.map(row => ({
    ticker: row.ticker,
    name: row.name,
    appearanceScore: row.appearanceScore,
  }));
};

export const markAutoAnalyzeTriggered = async (market: GainerMarket, tickers: string[]) => {
  if (tickers.length === 0) return;
  await withPrismaRetry(
    () =>
      prisma.marketGainerAppearance.updateMany({
        where: {
          market: toPrismaMarket(market),
          ticker: { in: tickers.map(t => t.toUpperCase()) },
        },
        data: { autoAnalyzeTriggeredAt: new Date() },
      }),
    'gainers.autoTriggered',
    2
  );
};
