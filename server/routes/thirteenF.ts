import express from 'express';
import type {
  ThirteenFAggregateDashboardRequest,
  ThirteenFHoldingSortField,
  ThirteenFPerformanceSortMode,
  ThirteenFQuarterId,
  ThirteenFSortDirection,
} from '../../types/thirteenF.js';
import {
  enrichPerformanceQuotes,
  getAggregate,
  getCachedPerformance,
  getChanges,
  getHoldings,
  getPerformance,
  getPerformanceSkeleton,
  getPresetsMock,
  getSectorEnrichmentStatus,
  isThirteenFLiveDataEnabled,
  saveCachedPerformance,
  searchInstitutions,
} from '../services/thirteenFService.js';
import {
  computeStakeSinceDate,
  parseStakeLookbackDays,
} from '../../utils/thirteenFStakeLookback.js';
import {
  enrichStakeItem4,
  parseStakeOwnershipBatch,
} from '../services/thirteenFStakeParseService.js';
import { backfillStakePriorBatch } from '../services/thirteenFStakeBackfillService.js';
import { invalidateStakeHistoryMemoryCache } from '../services/thirteenFStakeHistoryService.js';
import {
  getStakeFeed,
  isImportantTrackingEnabled,
  invalidateStakeFeedCache,
} from '../services/thirteenFStakeService.js';
import { getThirteenFCacheStatus } from '../services/thirteenFEdgarService.js';

const router = express.Router();

const parseQuarter = (value: unknown): ThirteenFQuarterId | undefined => {
  const text = String(value || '').trim();
  if (/^\d{4}-Q[1-4]$/.test(text)) {
    return text as ThirteenFQuarterId;
  }
  return undefined;
};

const parseRefresh = (value: unknown): boolean =>
  value === 'true' || value === '1' || value === true;

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    data: {
      liveDataEnabled: isThirteenFLiveDataEnabled(),
      importantTrackingEnabled: isImportantTrackingEnabled(),
      cache: getThirteenFCacheStatus(),
    },
  });
});

router.get('/institutions/search', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const items = await searchInstitutions(q);
    res.json({ ok: true, data: { items } });
  } catch (error) {
    console.error('[13f] search failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Search failed',
    });
  }
});

router.get('/presets', (_req, res) => {
  res.json({ ok: true, data: { presets: getPresetsMock() } });
});

router.get('/institutions/:cik/quarters', async (req, res) => {
  try {
    const holdings = await getHoldings(req.params.cik);
    res.json({ ok: true, data: { quarters: holdings.availableQuarters } });
  } catch (error) {
    console.error('[13f] quarters failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load quarters',
    });
  }
});

router.get('/institutions/:cik/holdings', async (req, res) => {
  try {
    const quarter = parseQuarter(req.query.quarter);
    const sortBy =
      req.query.sortBy === 'marketValue'
        ? ('marketValue' as ThirteenFHoldingSortField)
        : 'portfolioWeight';
    const sortDir =
      req.query.sortDir === 'asc' ? ('asc' as ThirteenFSortDirection) : 'desc';
    const forceRefresh = parseRefresh(req.query.refresh);
    const data = await getHoldings(req.params.cik, quarter, sortBy, sortDir, { forceRefresh });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] holdings failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load holdings',
    });
  }
});

router.get('/institutions/:cik/changes', async (req, res) => {
  try {
    const quarter = parseQuarter(req.query.quarter);
    const forceRefresh = parseRefresh(req.query.refresh);
    const data = await getChanges(req.params.cik, quarter, { forceRefresh });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] changes failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load changes',
    });
  }
});

router.get('/institutions/:cik/sector-enrichment', async (req, res) => {
  try {
    const quarter = parseQuarter(req.query.quarter);
    const data = await getSectorEnrichmentStatus(req.params.cik, quarter);
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] sector-enrichment status failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load sector enrichment status',
    });
  }
});

router.post('/aggregate', async (req, res) => {
  try {
    const body = req.body as ThirteenFAggregateDashboardRequest;
    const ciks = Array.isArray(body?.ciks) ? body.ciks.map(String) : [];
    if (ciks.length === 0) {
      return res.status(400).json({ ok: false, error: 'ciks is required' });
    }
    const data = await getAggregate({
      ciks,
      quarter: parseQuarter(body.quarter),
      minInstitutionCount: Number.isFinite(Number(body.minInstitutionCount))
        ? Number(body.minInstitutionCount)
        : 2,
    });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] aggregate failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load aggregate',
    });
  }
});

router.post('/performance', async (req, res) => {
  try {
    const ciks = Array.isArray(req.body?.ciks) ? req.body.ciks.map(String) : [];
    if (ciks.length === 0) {
      return res.status(400).json({ ok: false, error: 'ciks is required' });
    }
    const sortMode: ThirteenFPerformanceSortMode =
      req.body?.sortMode === 'by_return_pct' ? 'by_return_pct' : 'by_position_delta';
    const quarter = parseQuarter(req.body?.quarter);
    const forceRefresh = req.body?.refresh === true;

    if (req.body?.cachedOnly === true && !forceRefresh) {
      const cached = getCachedPerformance(ciks, quarter, sortMode);
      if (!cached) {
        return res.status(404).json({ ok: false, error: 'cache_miss' });
      }
      return res.json({ ok: true, data: cached, cacheHit: true });
    }

    const data =
      req.body?.skeleton === true
        ? await getPerformanceSkeleton(ciks, quarter, sortMode)
        : await getPerformance(ciks, quarter, sortMode, { forceRefresh });
    res.json({ ok: true, data, cacheHit: false });
  } catch (error) {
    console.error('[13f] performance failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load performance',
    });
  }
});

router.put('/performance/cache', async (req, res) => {
  try {
    const ciks = Array.isArray(req.body?.ciks) ? req.body.ciks.map(String) : [];
    const data = req.body?.data;
    if (ciks.length === 0 || !data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'ciks and data are required' });
    }
    const sortMode: ThirteenFPerformanceSortMode =
      req.body?.sortMode === 'by_return_pct' ? 'by_return_pct' : 'by_position_delta';
    saveCachedPerformance(ciks, parseQuarter(req.body?.quarter), sortMode, data);
    res.json({ ok: true });
  } catch (error) {
    console.error('[13f] performance cache save failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to save performance cache',
    });
  }
});

router.post('/performance/enrich', async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length === 0) {
      return res.status(400).json({ ok: false, error: 'entries is required' });
    }
    const quotes = await enrichPerformanceQuotes(
      entries.map((entry: Record<string, unknown>) => ({
        ticker: String(entry.ticker || ''),
        anchorDate: String(entry.anchorDate || ''),
        reportDate: String(entry.reportDate || ''),
        impliedReferencePriceUsd:
          entry.impliedReferencePriceUsd == null
            ? null
            : Number(entry.impliedReferencePriceUsd),
      }))
    );
    res.json({ ok: true, data: { quotes } });
  } catch (error) {
    console.error('[13f] performance enrich failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to enrich performance quotes',
    });
  }
});

router.post('/stake-feed', async (req, res) => {
  try {
    const ciks = Array.isArray(req.body?.ciks) ? req.body.ciks.map(String) : [];
    if (ciks.length === 0) {
      return res.status(400).json({ ok: false, error: 'ciks is required' });
    }
    const limit = Number.isFinite(Number(req.body?.limit)) ? Number(req.body.limit) : 100;
    const limitPerInstitution = Number.isFinite(Number(req.body?.limitPerInstitution))
      ? Number(req.body.limitPerInstitution)
      : 20;
    const lookbackDays = parseStakeLookbackDays(req.body?.lookbackDays);
    const sinceDate =
      typeof req.body?.sinceDate === 'string' && req.body.sinceDate.trim()
        ? req.body.sinceDate.trim()
        : computeStakeSinceDate(lookbackDays);
    const forceRefresh = req.body?.refresh === true;
    const data = await getStakeFeed({
      ciks,
      limit,
      limitPerInstitution,
      sinceDate,
      lookbackDays,
      forceRefresh,
    });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] stake-feed failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load stake feed',
    });
  }
});

router.post('/stake-feed/refresh', async (req, res) => {
  try {
    invalidateStakeFeedCache();
    invalidateStakeHistoryMemoryCache();
    const ciks = Array.isArray(req.body?.ciks) ? req.body.ciks.map(String) : [];
    if (ciks.length === 0) {
      return res.status(400).json({ ok: false, error: 'ciks is required' });
    }
    const limit = Number.isFinite(Number(req.body?.limit)) ? Number(req.body.limit) : 100;
    const limitPerInstitution = Number.isFinite(Number(req.body?.limitPerInstitution))
      ? Number(req.body.limitPerInstitution)
      : 20;
    const lookbackDays = parseStakeLookbackDays(req.body?.lookbackDays);
    const sinceDate =
      typeof req.body?.sinceDate === 'string' && req.body.sinceDate.trim()
        ? req.body.sinceDate.trim()
        : computeStakeSinceDate(lookbackDays);
    const data = await getStakeFeed({
      ciks,
      limit,
      limitPerInstitution,
      sinceDate,
      lookbackDays,
      forceRefresh: true,
    });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] stake-feed refresh failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to refresh stake feed',
    });
  }
});

router.post('/stake-feed/parse', async (req, res) => {
  try {
    const filings = Array.isArray(req.body?.filings) ? req.body.filings : [];
    if (filings.length === 0) {
      return res.status(400).json({ ok: false, error: 'filings is required' });
    }
    const data = await parseStakeOwnershipBatch({ filings });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] stake-feed parse failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse stake filings',
    });
  }
});

router.post('/stake-feed/backfill-prior', async (req, res) => {
  try {
    const filings = Array.isArray(req.body?.filings) ? req.body.filings : [];
    if (filings.length === 0) {
      return res.status(400).json({ ok: false, error: 'filings is required' });
    }
    const data = await backfillStakePriorBatch({ filings });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[13f] stake-feed backfill-prior failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to backfill stake prior ownership',
    });
  }
});

router.post('/stake-feed/item4', async (req, res) => {
  try {
    const accessionNumber = String(req.body?.accessionNumber ?? '').trim();
    const documentUrl = String(req.body?.documentUrl ?? '').trim();
    const formType = String(req.body?.formType ?? '').trim();
    const filerName = String(req.body?.filerName ?? '').trim();
    if (!accessionNumber || !documentUrl || !formType) {
      return res.status(400).json({ ok: false, error: 'accessionNumber, documentUrl, and formType are required' });
    }
    const data = await enrichStakeItem4({
      accessionNumber,
      documentUrl,
      formType,
      filerName,
      targetCompanyName:
        typeof req.body?.targetCompanyName === 'string' ? req.body.targetCompanyName : null,
      filingDate: typeof req.body?.filingDate === 'string' ? req.body.filingDate : undefined,
    });
    res.json({
      ok: true,
      data: {
        accessionNumber,
        item4Summary: data.item4Summary,
        item4SummaryStatus: data.item4SummaryStatus,
      },
    });
  } catch (error) {
    console.error('[13f] stake-feed item4 failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to enrich Item 4 summary',
    });
  }
});

export const thirteenFRouter = router;
