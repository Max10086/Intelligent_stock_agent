import type {
  ThirteenFAggregateDashboardRequest,
  ThirteenFAggregateDashboardResponse,
  ThirteenFConsensusDirection,
  ThirteenFHoldingsResponse,
  ThirteenFHoldingSortField,
  ThirteenFInstitution,
  ThirteenFPerformanceEntry,
  ThirteenFPerformanceEnrichRequestEntry,
  ThirteenFPerformanceQuoteEnrichment,
  ThirteenFPerformanceSortMode,
  ThirteenFPerformanceTrackingResponse,
  ThirteenFPositionChange,
  ThirteenFPositionChangeCategory,
  ThirteenFPositionChangesResponse,
  ThirteenFQuarterId,
  ThirteenFSortDirection,
} from '../../types/thirteenF.js';
import {
  getClearedPositions,
  getInstitutionByCik,
  getSeedHoldings,
  priorQuarter,
  QUARTER_CALENDAR,
  resolveQuarterMeta,
  scaleAumForQuarter,
  THIRTEEN_F_INSTITUTION_CATALOG,
  THIRTEEN_F_PRESET_INSTITUTIONS,
  BRIDGEWATER_SECTOR_DISTRIBUTION,
  type ClearedPosition,
  type SeedHolding,
} from './thirteenFMockData.js';
import { buildBridgewaterChangesFromSnapshot } from './thirteenFBridgewaterSnapshot.js';
import {
  getChangesFromEdgar,
  getHoldingsFromEdgar,
  getSectorEnrichmentStatusForInstitution,
  isThirteenFLiveDataEnabled,
} from './thirteenFEdgarService.js';
import {
  computeReturnFromAnchor,
  fetchHistoricalCloseMapByDate,
  fetchUsQuoteMap,
  inferThirteenFReferencePrice,
  rejectOutlierHistoricalClose,
} from './thirteenFQuoteService.js';
import {
  buildPerformanceCacheKey,
  clearDailyPerformanceCache,
  readDailyPerformanceCache,
  writeDailyPerformanceCache,
} from './thirteenFPerformanceCacheService.js';
import { searchInstitutionsRanked } from './thirteenFInstitutionSearchService.js';
import {
  normalizeInstitutionCik,
  resolveInstitutionCik,
} from '../../utils/thirteenFInstitutionSearch.js';
import { sortHoldingsRows } from '../../utils/thirteenFHoldingsSort.js';
import { clampConsensusMinInstitutionCount } from '../../utils/thirteenFConsensus.js';

export { isThirteenFLiveDataEnabled } from './thirteenFEdgarService.js';

const BRIDGEWATER_CIK = '0001350694';

const buildInstitutionNameLookup = (
  responses: ThirteenFPositionChangesResponse[],
  requestCiks: string[]
): Map<string, string> => {
  const lookup = new Map<string, string>();
  const remember = (cik: string, name: string) => {
    if (!cik || !name) return;
    lookup.set(normalizeInstitutionCik(cik), name);
  };

  for (let i = 0; i < requestCiks.length; i += 1) {
    const response = responses[i];
    if (!response) continue;
    const requestCik = requestCiks[i]!;
    const name =
      getInstitutionByCik(response.cik)?.shortName ??
      getInstitutionByCik(requestCik)?.shortName ??
      getInstitutionByCik(resolveInstitutionCik(requestCik))?.shortName ??
      response.institutionName;
    remember(response.cik, name);
    remember(requestCik, name);
    remember(resolveInstitutionCik(requestCik), name);
  }

  return lookup;
};

const resolveInstitutionDisplayName = (
  cik: string,
  lookup: Map<string, string>
): string => {
  const normalized = normalizeInstitutionCik(cik);
  const resolved = resolveInstitutionCik(cik);
  return (
    getInstitutionByCik(normalized)?.shortName ??
    getInstitutionByCik(resolved)?.shortName ??
    lookup.get(normalized) ??
    lookup.get(resolved) ??
    cik
  );
};

const institutionsFromCiks = (
  ciks: string[],
  lookup: Map<string, string>
): ThirteenFInstitution[] =>
  ciks.map(cik => {
    const normalized = normalizeInstitutionCik(cik);
    const catalog =
      getInstitutionByCik(cik) ?? getInstitutionByCik(resolveInstitutionCik(cik));
    if (catalog) return catalog;
    const name = resolveInstitutionDisplayName(cik, lookup);
    return { cik: normalized, name, shortName: name };
  });

const classifyChange = (
  priorShares: number,
  currentShares: number
): ThirteenFPositionChangeCategory | null => {
  if (priorShares <= 0 && currentShares > 0) return 'NEW';
  if (priorShares > 0 && currentShares <= 0) return 'CLEAR';
  if (currentShares > priorShares) return 'ADD';
  if (currentShares < priorShares) return 'REDUCE';
  return null;
};

const resolveShareCounts = (
  row: SeedHolding,
  currentMarketValueUsd: number,
  totalAum: number
): { shares: number; priorShares: number } => {
  const sharesFromWeight = Math.max(
    0,
    Math.round(currentMarketValueUsd / Math.max(row.priceUsd, 0.01))
  );

  if (row.changeHint === 'NEW') {
    return { shares: sharesFromWeight, priorShares: 0 };
  }

  if (row.changeHint === 'CLEAR') {
    return { shares: 0, priorShares: sharesFromWeight };
  }

  const deltaPct = row.sharesDeltaPct ?? 0;
  const priorShares = Math.max(0, Math.round(sharesFromWeight / (1 + deltaPct / 100)));
  return { shares: sharesFromWeight, priorShares };
};

const buildHoldingsFromSeed = (
  cik: string,
  quarter: ThirteenFQuarterId,
  seed: SeedHolding[]
) => {
  const meta = resolveQuarterMeta(quarter);
  const institution = getInstitutionByCik(cik);
  const totalAum = scaleAumForQuarter(quarter);
  const priorMeta = resolveQuarterMeta(priorQuarter(quarter));

  const holdings = seed
    .filter(row => row.changeHint !== 'CLEAR')
    .map((row, index) => {
      const marketValueUsd = (totalAum * row.weightPct) / 100;
      const { shares, priorShares } = resolveShareCounts(row, marketValueUsd, totalAum);
      const sharesDelta = shares - priorShares;
      const priorMarketValueUsd = priorShares * row.priceUsd;
      const priorWeightPct =
        totalAum > 0 ? (priorMarketValueUsd / totalAum) * 100 : 0;
      const weightDeltaPct = row.weightPct - priorWeightPct;

      return {
        id: `${cik}-${quarter}-${row.ticker}`,
        cik,
        quarter,
        ticker: row.ticker,
        name: row.name,
        sector: row.sector,
        shares,
        marketValueUsd: shares * row.priceUsd,
        portfolioWeightPct: totalAum > 0 ? ((shares * row.priceUsd) / totalAum) * 100 : 0,
        rank: index + 1,
        filingDate: meta.filingDate,
        reportDate: meta.reportDate,
        sharesDelta,
        weightDeltaPct,
        referencePriceUsd: row.priceUsd,
        priorShares,
        priorMarketValueUsd,
        priorWeightPct,
        priorQuarter: priorMeta.quarter,
        changeHint: row.changeHint,
      };
    })
    .filter(row => row.shares > 0);

  return { holdings, institution, meta, totalAum, priorMeta };
};

const buildClearChanges = (
  cik: string,
  quarter: ThirteenFQuarterId,
  prior: ThirteenFQuarterId,
  cleared: ClearedPosition[],
  totalAum: number,
  filingDate: string
): ThirteenFPositionChange[] =>
  cleared.map(row => {
    const priorMarketValueUsd = (totalAum * row.priorWeightPct) / 100;
    const priorShares = Math.round(priorMarketValueUsd / Math.max(row.priceUsd, 0.01));
    return {
      id: `${cik}-${quarter}-clear-${row.ticker}`,
      cik,
      quarter,
      priorQuarter: prior,
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      category: 'CLEAR',
      priorShares,
      currentShares: null,
      sharesDelta: -priorShares,
      priorMarketValueUsd,
      currentMarketValueUsd: null,
      marketValueDeltaUsd: -priorMarketValueUsd,
      priorWeightPct: row.priorWeightPct,
      currentWeightPct: null,
      weightDeltaPct: -row.priorWeightPct,
    };
  });

export const searchInstitutions = async (query: string): Promise<ThirteenFInstitution[]> =>
  searchInstitutionsRanked(query);

const getHoldingsFromMock = (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null,
  sortBy: ThirteenFHoldingSortField = 'portfolioWeight',
  sortDir: ThirteenFSortDirection = 'desc'
): ThirteenFHoldingsResponse => {
  const quarter = quarterInput ?? QUARTER_CALENDAR[0].quarter;
  const seed = getSeedHoldings(cik);
  const { holdings: raw, institution, meta, totalAum } = buildHoldingsFromSeed(
    cik,
    quarter,
    seed
  );

  const sorted = sortHoldingsRows(raw, sortBy, sortDir, totalAum);
  const ranked = sorted;

  const bySectorMap = new Map<string, number>();
  for (const row of ranked) {
    bySectorMap.set(row.sector, (bySectorMap.get(row.sector) ?? 0) + row.marketValueUsd);
  }
  const bySector =
    cik === BRIDGEWATER_CIK
      ? BRIDGEWATER_SECTOR_DISTRIBUTION.map(row => ({
          ...row,
          marketValueUsd: (totalAum * row.weightPct) / 100,
        }))
      : [...bySectorMap.entries()]
          .map(([sector, marketValueUsd]) => ({
            key: sector,
            label: sector,
            marketValueUsd,
            weightPct: totalAum > 0 ? (marketValueUsd / totalAum) * 100 : 0,
          }))
          .sort((a, b) => b.marketValueUsd - a.marketValueUsd);

  const byStock = ranked.slice(0, 12).map(row => ({
    key: row.ticker,
    label: row.ticker,
    marketValueUsd: row.marketValueUsd,
    weightPct: row.portfolioWeightPct,
  }));

  return {
    summary: {
      cik,
      institutionName: institution?.name ?? cik,
      description: institution?.description,
      quarter,
      filingDate: meta.filingDate,
      reportDate: meta.reportDate,
      totalMarketValueUsd: totalAum,
      holdingCount: ranked.length,
      topSector: bySector[0]?.label,
    },
    holdings: ranked,
    distribution: { byStock, bySector },
    availableQuarters: QUARTER_CALENDAR,
    sectorEnrichment: {
      status: 'complete',
      pendingCount: 0,
      totalCount: 0,
      resolvedCount: 0,
    },
  };
};

export const getHoldings = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null,
  sortBy: ThirteenFHoldingSortField = 'portfolioWeight',
  sortDir: ThirteenFSortDirection = 'desc',
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFHoldingsResponse> => {
  const resolvedCik = resolveInstitutionCik(cik);
  if (isThirteenFLiveDataEnabled()) {
    try {
      return await getHoldingsFromEdgar(resolvedCik, quarterInput, sortBy, sortDir, options);
    } catch (error) {
      if (!getInstitutionByCik(resolvedCik)) {
        throw error;
      }
      console.warn(
        `[13f] EDGAR holdings failed for ${resolvedCik}, falling back to mock:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return getHoldingsFromMock(resolvedCik, quarterInput, sortBy, sortDir);
};

/** @deprecated use getHoldings */
export const getHoldingsMock = getHoldings;

export const getSectorEnrichmentStatus = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null
) => {
  const resolvedCik = resolveInstitutionCik(cik);
  if (isThirteenFLiveDataEnabled()) {
    try {
      return await getSectorEnrichmentStatusForInstitution(resolvedCik, quarterInput);
    } catch (error) {
      console.warn(
        `[13f] sector enrichment status failed for ${resolvedCik}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return {
    status: 'complete' as const,
    pendingCount: 0,
    totalCount: 0,
    resolvedCount: 0,
  };
};

const getChangesFromMock = (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null
): ThirteenFPositionChangesResponse => {
  const quarter = quarterInput ?? QUARTER_CALENDAR[0].quarter;
  const prior = priorQuarter(quarter);
  const institution = getInstitutionByCik(cik);
  const meta = resolveQuarterMeta(quarter);

  if (cik === BRIDGEWATER_CIK && quarter === '2025-Q2') {
    const { changes, counts } = buildBridgewaterChangesFromSnapshot(
      cik,
      quarter,
      prior
    );
    return {
      cik,
      institutionName: institution?.name ?? cik,
      quarter,
      priorQuarter: prior,
      filingDate: meta.filingDate,
      changes,
      counts,
      totalCounts: counts,
      availableQuarters: QUARTER_CALENDAR,
    };
  }

  const seed = getSeedHoldings(cik);
  const { holdings, totalAum } = buildHoldingsFromSeed(cik, quarter, seed);

  const changes: ThirteenFPositionChange[] = [];

  for (const row of holdings) {
    const priorShares = row.priorShares ?? 0;
    const category = classifyChange(priorShares, row.shares);
    if (!category) continue;

    changes.push({
      id: `${cik}-${quarter}-chg-${row.ticker}`,
      cik,
      quarter,
      priorQuarter: prior,
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      category,
      priorShares: priorShares > 0 ? priorShares : null,
      currentShares: row.shares > 0 ? row.shares : null,
      sharesDelta: row.sharesDelta ?? 0,
      priorMarketValueUsd: row.priorMarketValueUsd ?? null,
      currentMarketValueUsd: row.marketValueUsd,
      marketValueDeltaUsd: row.marketValueUsd - (row.priorMarketValueUsd ?? 0),
      priorWeightPct: row.priorWeightPct ?? null,
      currentWeightPct: row.portfolioWeightPct,
      weightDeltaPct: row.weightDeltaPct ?? null,
    });
  }

  changes.push(
    ...buildClearChanges(
      cik,
      quarter,
      prior,
      getClearedPositions(cik),
      totalAum,
      meta.filingDate
    )
  );

  changes.sort(
    (a, b) => Math.abs(b.marketValueDeltaUsd) - Math.abs(a.marketValueDeltaUsd)
  );

  const counts: Record<ThirteenFPositionChangeCategory, number> = {
    NEW: 0,
    ADD: 0,
    REDUCE: 0,
    CLEAR: 0,
  };
  for (const change of changes) {
    counts[change.category] += 1;
  }

  return {
    cik,
    institutionName: institution?.name ?? cik,
    quarter,
    priorQuarter: prior,
    filingDate: meta.filingDate,
    reportDate: meta.reportDate,
    changes,
    counts,
    totalCounts: counts,
    availableQuarters: QUARTER_CALENDAR,
  };
};

export const getChanges = async (
  cik: string,
  quarterInput?: ThirteenFQuarterId | null,
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFPositionChangesResponse> => {
  const resolvedCik = resolveInstitutionCik(cik);
  if (isThirteenFLiveDataEnabled()) {
    try {
      return await getChangesFromEdgar(resolvedCik, quarterInput, options);
    } catch (error) {
      if (!getInstitutionByCik(resolvedCik)) {
        throw error;
      }
      console.warn(
        `[13f] EDGAR changes failed for ${resolvedCik}, falling back to mock:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return getChangesFromMock(resolvedCik, quarterInput);
};

/** @deprecated use getChanges */
export const getChangesMock = getChanges;

const CHANGE_CATEGORY_RANK: Record<ThirteenFPositionChangeCategory, number> = {
  NEW: 4,
  ADD: 3,
  REDUCE: 2,
  CLEAR: 1,
};

const pickHigherRankCategory = (
  left: ThirteenFPositionChangeCategory,
  right: ThirteenFPositionChangeCategory
): ThirteenFPositionChangeCategory =>
  CHANGE_CATEGORY_RANK[left] >= CHANGE_CATEGORY_RANK[right] ? left : right;

/** One institution may report multiple 13F line items for the same ticker (e.g. share classes). */
const mergeConsensusChangesByInstitutionTicker = (
  changes: ThirteenFPositionChange[]
): ThirteenFPositionChange[] => {
  const merged = new Map<string, ThirteenFPositionChange>();
  for (const change of changes) {
    const cik = normalizeInstitutionCik(change.cik);
    const ticker = change.ticker.trim().toUpperCase();
    const key = `${cik}|${ticker}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...change, cik, ticker });
      continue;
    }
    merged.set(key, {
      ...existing,
      category: pickHigherRankCategory(existing.category, change.category),
      marketValueDeltaUsd: existing.marketValueDeltaUsd + change.marketValueDeltaUsd,
      sharesDelta: existing.sharesDelta + change.sharesDelta,
      currentMarketValueUsd:
        Math.max(existing.currentMarketValueUsd ?? 0, change.currentMarketValueUsd ?? 0) ||
        existing.currentMarketValueUsd ||
        change.currentMarketValueUsd,
      currentShares:
        Math.max(existing.currentShares ?? 0, change.currentShares ?? 0) ||
        existing.currentShares ||
        change.currentShares,
    });
  }
  return [...merged.values()];
};

export const getAggregate = async (
  request: ThirteenFAggregateDashboardRequest
): Promise<ThirteenFAggregateDashboardResponse> => {
  const quarter = request.quarter ?? QUARTER_CALENDAR[0].quarter;
  const prior = priorQuarter(quarter);
  const uniqueCiks = [
    ...new Set(
      request.ciks.map(cik => resolveInstitutionCik(String(cik))).filter(Boolean)
    ),
  ];
  const minCount = clampConsensusMinInstitutionCount(
    request.minInstitutionCount ?? 2,
    uniqueCiks.length
  );

  const changeResponses = await Promise.all(
    uniqueCiks.map(cik => getChanges(cik, quarter))
  );
  const nameLookup = buildInstitutionNameLookup(changeResponses, uniqueCiks);
  const allChanges = mergeConsensusChangesByInstitutionTicker(
    changeResponses.flatMap(response => response.changes)
  );

  const stockMap = new Map<
    string,
    {
      ticker: string;
      name: string;
      sector: string;
      netUsd: number;
      institutions: ThirteenFAggregateDashboardResponse['stockConsensus'][0]['institutions'];
    }
  >();

  for (const change of allChanges) {
    const direction: ThirteenFConsensusDirection =
      change.category === 'NEW' || change.category === 'ADD' ? 'BUY' : 'SELL';
    const signedDelta =
      direction === 'BUY' ? change.marketValueDeltaUsd : change.marketValueDeltaUsd;

    const entry = stockMap.get(change.ticker) ?? {
      ticker: change.ticker,
      name: change.name,
      sector: change.sector,
      netUsd: 0,
      institutions: [],
    };
    entry.netUsd += signedDelta;
    entry.institutions.push({
      cik: normalizeInstitutionCik(change.cik),
      name: resolveInstitutionDisplayName(change.cik, nameLookup),
      category: change.category,
      marketValueDeltaUsd: change.marketValueDeltaUsd,
    });
    stockMap.set(change.ticker, entry);
  }

  const stockConsensus = [...stockMap.values()]
    .map(row => {
      const buyInstitutions = row.institutions.filter(
        inst => inst.category === 'NEW' || inst.category === 'ADD'
      );
      const sellInstitutions = row.institutions.filter(
        inst => inst.category === 'REDUCE' || inst.category === 'CLEAR'
      );
      const buyCount = buyInstitutions.length;
      const sellCount = sellInstitutions.length;
      const direction: ThirteenFConsensusDirection = buyCount >= sellCount ? 'BUY' : 'SELL';
      const institutionCount = direction === 'BUY' ? buyCount : sellCount;
      return {
        ticker: row.ticker,
        name: row.name,
        sector: row.sector,
        direction,
        institutionCount,
        institutions: row.institutions,
        netMarketValueDeltaUsd: row.netUsd,
      };
    })
    .filter(row => row.institutionCount >= minCount)
    .sort((a, b) => b.institutionCount - a.institutionCount);

  const sectorMap = new Map<
    string,
    {
      sector: string;
      buyInstitutions: Set<string>;
      sellInstitutions: Set<string>;
      netUsd: number;
      tickers: Set<string>;
    }
  >();

  for (const stock of stockConsensus) {
    const sectorEntry = sectorMap.get(stock.sector) ?? {
      sector: stock.sector,
      buyInstitutions: new Set<string>(),
      sellInstitutions: new Set<string>(),
      netUsd: 0,
      tickers: new Set<string>(),
    };
    sectorEntry.netUsd += stock.netMarketValueDeltaUsd;
    sectorEntry.tickers.add(stock.ticker);
    for (const inst of stock.institutions) {
      if (inst.category === 'NEW' || inst.category === 'ADD') {
        sectorEntry.buyInstitutions.add(inst.cik);
      } else {
        sectorEntry.sellInstitutions.add(inst.cik);
      }
    }
    sectorMap.set(stock.sector, sectorEntry);
  }

  const sectorConsensus = [...sectorMap.values()]
    .map(row => {
      const direction: ThirteenFConsensusDirection =
        row.buyInstitutions.size >= row.sellInstitutions.size ? 'BUY' : 'SELL';
      const institutionCount =
        direction === 'BUY' ? row.buyInstitutions.size : row.sellInstitutions.size;
      return {
        sector: row.sector,
        direction,
        institutionCount,
        netMarketValueDeltaUsd: row.netUsd,
        tickerCount: row.tickers.size,
        topTickers: [...row.tickers].slice(0, 5),
      };
    })
    .filter(row => row.institutionCount >= minCount)
    .sort((a, b) => Math.abs(b.netMarketValueDeltaUsd) - Math.abs(a.netMarketValueDeltaUsd));

  return {
    quarter,
    priorQuarter: prior,
    institutions: institutionsFromCiks(uniqueCiks, nameLookup),
    stockConsensus,
    sectorConsensus,
  };
};

/** @deprecated use getAggregate */
export const getAggregateMock = getAggregate;

const buildImpliedPriceMap = (
  buyChanges: Array<{ change: ThirteenFPositionChange; response: ThirteenFPositionChangesResponse }>
): Map<string, number> => {
  const impliedPriceByTicker = new Map<string, number>();
  for (const { change } of buyChanges) {
    if (impliedPriceByTicker.has(change.ticker)) {
      continue;
    }
    const implied = inferThirteenFReferencePrice(
      change.currentMarketValueUsd,
      change.currentShares
    );
    if (implied != null) {
      impliedPriceByTicker.set(change.ticker, implied);
    }
  }
  return impliedPriceByTicker;
};

const normalizePerformanceTicker = (ticker: string): string => ticker.trim().toUpperCase();

const buildPerformanceQuoteEnrichment = (
  request: ThirteenFPerformanceEnrichRequestEntry,
  quoteMap: Map<string, { price: number; status: 'ok' | 'missing' }>,
  historicalMap: Map<string, number>,
  impliedPriceByTicker: Map<string, number>
): ThirteenFPerformanceQuoteEnrichment => {
  const ticker = normalizePerformanceTicker(request.ticker);
  const fallbackImplied =
    request.impliedReferencePriceUsd ?? impliedPriceByTicker.get(ticker) ?? null;
  const historicalClose = rejectOutlierHistoricalClose(
    historicalMap.get(`${ticker}|${request.anchorDate.trim()}|on_or_after`) ?? null,
    fallbackImplied
  );
  const reportHistoricalClose = rejectOutlierHistoricalClose(
    historicalMap.get(`${ticker}|${request.reportDate.trim()}|on_or_before`) ?? null,
    fallbackImplied
  );

  const enrichment: ThirteenFPerformanceQuoteEnrichment = {
    ticker,
    anchorPriceUsd: null,
    reportPriceUsd: null,
    currentPriceUsd: null,
    returnPct: null,
    reportReturnPct: null,
    quoteStatus: 'missing_anchor',
  };

  if (historicalClose != null) {
    enrichment.anchorPriceUsd = historicalClose;
    enrichment.quoteStatus = 'ok';
  }

  if (reportHistoricalClose != null) {
    enrichment.reportPriceUsd = reportHistoricalClose;
  } else if (fallbackImplied != null) {
    enrichment.reportPriceUsd = fallbackImplied;
  }

  const quote = quoteMap.get(ticker);
  if (!quote || quote.status !== 'ok') {
    enrichment.quoteStatus =
      enrichment.quoteStatus === 'ok' ? 'missing_current' : enrichment.quoteStatus;
    return enrichment;
  }

  enrichment.currentPriceUsd = quote.price;
  enrichment.returnPct =
    enrichment.anchorPriceUsd != null
      ? computeReturnFromAnchor(enrichment.anchorPriceUsd, quote.price)
      : null;
  enrichment.reportReturnPct =
    enrichment.reportPriceUsd != null
      ? computeReturnFromAnchor(enrichment.reportPriceUsd, quote.price)
      : null;
  if (enrichment.returnPct == null && enrichment.quoteStatus === 'ok') {
    enrichment.quoteStatus = 'missing_anchor';
  }

  return enrichment;
};

export const enrichPerformanceQuotes = async (
  requests: ThirteenFPerformanceEnrichRequestEntry[]
): Promise<ThirteenFPerformanceQuoteEnrichment[]> => {
  if (requests.length === 0) {
    return [];
  }

  const tickers = requests.map(request => normalizePerformanceTicker(request.ticker));
  const historicalRequests = requests.flatMap(request => {
    const ticker = normalizePerformanceTicker(request.ticker);
    return [
      { ticker, anchorDateIso: request.anchorDate.trim(), mode: 'on_or_after' as const },
      { ticker, anchorDateIso: request.reportDate.trim(), mode: 'on_or_before' as const },
    ];
  });
  const impliedPriceByTicker = new Map(
    requests
      .filter(request => request.impliedReferencePriceUsd != null)
      .map(request => [
        normalizePerformanceTicker(request.ticker),
        request.impliedReferencePriceUsd as number,
      ])
  );

  const [quoteMap, historicalMap] = await Promise.all([
    fetchUsQuoteMap(tickers),
    fetchHistoricalCloseMapByDate(historicalRequests),
  ]);

  return requests.map(request =>
    buildPerformanceQuoteEnrichment(request, quoteMap, historicalMap, impliedPriceByTicker)
  );
};

const sortPerformanceEntries = (
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

const collectPerformanceBuySide = async (
  ciks: string[],
  quarter: ThirteenFQuarterId
) => {
  const meta = resolveQuarterMeta(quarter);
  const defaultFilingDate = meta.filingDate;
  const changeResponses = await Promise.all(ciks.map(cik => getChanges(cik, quarter)));
  const excludedInstitutions = changeResponses
    .filter(response => response.quarter !== quarter)
    .map(response => ({
      cik: response.cik,
      name: response.institutionName,
      availableQuarter: response.quarter,
    }));
  const eligibleResponses = changeResponses.filter(response => response.quarter === quarter);
  const nameLookup = buildInstitutionNameLookup(eligibleResponses, ciks);
  const buyChanges = eligibleResponses.flatMap(response =>
    response.changes
      .filter(change => change.category === 'NEW' || change.category === 'ADD')
      .map(change => ({ change, response }))
  );

  const entryMap = new Map<string, ThirteenFPerformanceEntry>();
  const asOfDate = new Date().toISOString().slice(0, 10);

  for (const { change, response } of buyChanges) {
    const existing = entryMap.get(change.ticker);
    const inst = {
      cik: change.cik,
      name: resolveInstitutionDisplayName(change.cik, nameLookup),
      sharesDelta: change.sharesDelta,
      marketValueDeltaUsd: change.marketValueDeltaUsd,
    };
    if (existing) {
      existing.institutions.push(inst);
      existing.totalMarketValueDeltaUsd += change.marketValueDeltaUsd;
      existing.totalSharesDelta += change.sharesDelta;
      const filingDate = response.filingDate || defaultFilingDate;
      if (filingDate < existing.anchorDate) {
        existing.anchorDate = filingDate;
      }
      continue;
    }

    entryMap.set(change.ticker, {
      ticker: change.ticker,
      name: change.name,
      sector: change.sector,
      category: change.category === 'NEW' ? 'NEW' : 'ADD',
      institutions: [inst],
      totalMarketValueDeltaUsd: change.marketValueDeltaUsd,
      totalSharesDelta: change.sharesDelta,
      anchorDate: response.filingDate || defaultFilingDate,
      anchorPriceUsd: null,
      reportDate: response.reportDate || meta.reportDate,
      reportPriceUsd: null,
      currentPriceUsd: null,
      currentDate: asOfDate,
      returnPct: null,
      reportReturnPct: null,
      quoteStatus: 'missing_anchor',
      impliedReferencePriceUsd: null,
    });
  }

  const impliedPriceByTicker = buildImpliedPriceMap(buyChanges);
  for (const entry of entryMap.values()) {
    entry.impliedReferencePriceUsd = impliedPriceByTicker.get(entry.ticker) ?? null;
  }

  return {
    quarter,
    meta,
    asOfDate,
    buyChanges,
    excludedInstitutions,
    nameLookup,
    entryMap,
    impliedPriceByTicker,
  };
};

export const getPerformanceSkeleton = async (
  ciks: string[],
  quarterInput?: ThirteenFQuarterId | null,
  sortMode: ThirteenFPerformanceSortMode = 'by_position_delta'
): Promise<ThirteenFPerformanceTrackingResponse> => {
  const quarter = quarterInput ?? QUARTER_CALENDAR[0].quarter;
  const {
    asOfDate,
    buyChanges,
    excludedInstitutions,
    nameLookup,
    entryMap,
  } = await collectPerformanceBuySide(ciks, quarter);

  const entries = sortPerformanceEntries([...entryMap.values()], sortMode);
  const newCount = buyChanges.filter(item => item.change.category === 'NEW').length;
  const addCount = buyChanges.filter(item => item.change.category === 'ADD').length;

  return {
    quarter,
    institutions: institutionsFromCiks(
      ciks.filter(cik => !excludedInstitutions.some(item => item.cik === cik)),
      nameLookup
    ),
    entries,
    asOfDate,
    sortMode,
    scope: {
      buySideTickers: entries.length,
      newCount,
      addCount,
    },
    excludedInstitutions:
      excludedInstitutions.length > 0 ? excludedInstitutions : undefined,
  };
};

const buildPerformanceEntries = async (
  ciks: string[],
  quarterInput?: ThirteenFQuarterId | null,
  sortMode: ThirteenFPerformanceSortMode = 'by_position_delta'
): Promise<ThirteenFPerformanceTrackingResponse> => {
  const skeleton = await getPerformanceSkeleton(ciks, quarterInput, 'by_position_delta');
  if (skeleton.entries.length === 0) {
    return { ...skeleton, sortMode };
  }

  const quotes = await enrichPerformanceQuotes(
    skeleton.entries.map(entry => ({
      ticker: entry.ticker,
      anchorDate: entry.anchorDate,
      reportDate: entry.reportDate,
      impliedReferencePriceUsd: entry.impliedReferencePriceUsd,
    }))
  );
  const quoteByTicker = new Map(quotes.map(quote => [quote.ticker, quote]));
  const entries = skeleton.entries.map(entry => {
    const quote = quoteByTicker.get(entry.ticker);
    if (!quote) {
      return entry;
    }
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
    ...skeleton,
    sortMode,
    entries: sortPerformanceEntries(entries, sortMode),
  };
};

export const getCachedPerformance = (
  ciks: string[],
  quarterInput?: ThirteenFQuarterId | null,
  sortMode: ThirteenFPerformanceSortMode = 'by_position_delta'
): ThirteenFPerformanceTrackingResponse | null => {
  const key = buildPerformanceCacheKey(ciks, quarterInput, sortMode);
  return readDailyPerformanceCache(key);
};

export const saveCachedPerformance = (
  ciks: string[],
  quarterInput: ThirteenFQuarterId | null | undefined,
  sortMode: ThirteenFPerformanceSortMode,
  data: ThirteenFPerformanceTrackingResponse
): void => {
  const key = buildPerformanceCacheKey(ciks, quarterInput, sortMode);
  writeDailyPerformanceCache(key, data);
};

export const getPerformance = async (
  ciks: string[],
  quarterInput?: ThirteenFQuarterId | null,
  sortMode: ThirteenFPerformanceSortMode = 'by_position_delta',
  options?: { forceRefresh?: boolean }
): Promise<ThirteenFPerformanceTrackingResponse> => {
  const key = buildPerformanceCacheKey(ciks, quarterInput, sortMode);
  if (!options?.forceRefresh) {
    const hit = readDailyPerformanceCache(key);
    if (hit) {
      return hit;
    }
  } else {
    clearDailyPerformanceCache(key);
  }

  const result = await buildPerformanceEntries(ciks, quarterInput, sortMode);
  writeDailyPerformanceCache(key, result);
  return result;
};

/** @deprecated use getPerformance */
export const getPerformanceMock = getPerformance;

export const getPresetsMock = () => THIRTEEN_F_PRESET_INSTITUTIONS;
