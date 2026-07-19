import express from 'express';
import { GoogleGenAI } from '@google/genai';
import type { GainerMarket, GainerPeriod } from '../../types/marketGainers.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { ModelClient } from '../services/modelClient.js';
import {
  getMarketGainerList,
  getMarketGainerSnapshotHistory,
  getUserGainerPreference,
  refreshMarketGainers,
  updateUserGainerPreference,
} from '../services/marketGainersService.js';
import { runGainerAutoAnalyzeForAdmins } from '../services/gainerAutoAnalyzeService.js';
import { addToQueue } from '../actions/queue.js';
import { startQueueProcessing } from '../actions/process.js';
import { assertCanAnalyzeCompanies, UsageLimitError } from '../services/usageLimit.js';
import { prisma, withPrismaRetry } from '../db.js';
import { trackUserEvent } from '../services/analytics.js';
import {
  shouldRunDailyRefresh,
  shouldRunWeeklyRefresh,
} from '../../utils/tradingCalendar.js';
import { createGoogleGenAIClient } from '../lib/googleGenAIClient.js';

let aiClient: GoogleGenAI | null = null;
let modelClient: ModelClient | null = null;
let manualFetchInFlight: Promise<unknown> | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = createGoogleGenAIClient();
  }
  return aiClient;
}

function getModelClient(): ModelClient {
  if (!modelClient) {
    modelClient = new ModelClient(getAIClient());
  }
  return modelClient;
}

const parseMarket = (value: unknown): GainerMarket | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'US' || normalized === 'CN' || normalized === 'HK') {
    return normalized;
  }
  return null;
};

const parsePeriod = (value: unknown, market: GainerMarket): GainerPeriod | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'WEEKLY') return 'WEEKLY';
  if (normalized === 'THREE_DAY' || normalized === '3DAY' || normalized === '3D') {
    return market === 'CN' ? 'THREE_DAY' : null;
  }
  if (normalized === 'DAILY' || normalized === 'DAY') {
    return market === 'CN' ? 'THREE_DAY' : 'DAILY';
  }
  return null;
};

const defaultPeriodForMarket = (market: GainerMarket): GainerPeriod =>
  market === 'CN' ? 'THREE_DAY' : 'DAILY';

const verifyCronSecret = (req: express.Request): boolean => {
  const secret = process.env.CRON_SECRET || process.env.GAINER_CRON_SECRET || '';
  if (!secret) return false;
  const header = req.headers['x-cron-secret'];
  return typeof header === 'string' && header === secret;
};

const executeGainerRefresh = async (options: {
  market?: GainerMarket | null;
  period?: GainerPeriod | null;
  force?: boolean;
  runAutoAnalyze?: boolean;
  validateQuotes?: boolean;
}) => {
  const modelClient = getModelClient();
  const force = options.force ?? false;
  const runAutoAnalyze = options.runAutoAnalyze ?? false;
  const validateQuotes = options.validateQuotes ?? false;
  const now = new Date();
  const market = options.market ?? null;
  const period = options.period ?? null;

  const jobs: Array<{ market: GainerMarket; period: GainerPeriod; result: unknown }> = [];

  const runRefresh = async (
    targetMarket: GainerMarket,
    targetPeriod: GainerPeriod,
    useForce = force
  ) => {
    const result = await refreshMarketGainers({
      market: targetMarket,
      period: targetPeriod,
      modelClient,
      force: useForce,
      validateQuotes,
    });
    jobs.push({ market: targetMarket, period: targetPeriod, result });
  };

  if (market && period) {
    await runRefresh(market, period, true);
  } else if (market) {
    if (shouldRunDailyRefresh(market, now) || force) {
      await runRefresh(market, market === 'CN' ? 'THREE_DAY' : 'DAILY');
    }
    if (shouldRunWeeklyRefresh(market, now) || force) {
      await runRefresh(market, 'WEEKLY');
    }
  } else {
    for (const targetMarket of ['US', 'CN'] as GainerMarket[]) {
      if (shouldRunDailyRefresh(targetMarket, now) || force) {
        await runRefresh(targetMarket, targetMarket === 'CN' ? 'THREE_DAY' : 'DAILY');
      }
      if (shouldRunWeeklyRefresh(targetMarket, now) || force) {
        await runRefresh(targetMarket, 'WEEKLY');
      }
    }
  }

  const autoAnalyze = runAutoAnalyze ? await runGainerAutoAnalyzeForAdmins() : { triggered: 0 };
  return { jobs, autoAnalyze };
};

const runScheduledRefresh = async (req: express.Request) => {
  const market = parseMarket(req.body?.market || req.query.market);
  const period = market ? parsePeriod(req.body?.period || req.query.period, market) : null;
  const force = req.body?.force === true || req.query.force === 'true';
  return executeGainerRefresh({
    market,
    period,
    force,
    runAutoAnalyze: true,
  });
};

/** Cron-only refresh — mounted without user auth. */
export const marketGainersRefreshRouter = express.Router();
marketGainersRefreshRouter.post('/', async (req, res) => {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = await runScheduledRefresh(req);
    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    console.error('[gainers] refresh failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to refresh gainers',
    });
  }
});

const router = express.Router();

router.get('/history', requireAdmin, async (req, res) => {
  try {
    const market = parseMarket(req.query.market) || 'US';
    const period = parsePeriod(req.query.period, market) || defaultPeriodForMarket(market);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 60;
    const items = await getMarketGainerSnapshotHistory(market, period, limit);
    res.json({ items });
  } catch (error: unknown) {
    console.error('[gainers] history failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load gainer history',
    });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const market = parseMarket(req.query.market) || 'US';
    const period = parsePeriod(req.query.period, market) || defaultPeriodForMarket(market);
    const tradingDateEnd =
      typeof req.query.tradingDateEnd === 'string' ? req.query.tradingDateEnd : undefined;
    const data = await getMarketGainerList(market, period, tradingDateEnd);
    res.json(data);
  } catch (error: unknown) {
    console.error('[gainers] list failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load gainer list',
    });
  }
});

router.get('/preferences', requireAdmin, async (req, res) => {
  try {
    const pref = await getUserGainerPreference(req.user!.id);
    res.json(pref);
  } catch (error: unknown) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load gainer preferences',
    });
  }
});

router.patch('/preferences', requireAdmin, async (req, res) => {
  try {
    const pref = await updateUserGainerPreference(req.user!.id, {
      autoAnalyzeEnabled: req.body?.autoAnalyzeEnabled,
      autoAnalyzeMarkets: Array.isArray(req.body?.autoAnalyzeMarkets)
        ? req.body.autoAnalyzeMarkets
        : undefined,
      minAppearanceScore: Number.isFinite(Number(req.body?.minAppearanceScore))
        ? Number(req.body.minAppearanceScore)
        : undefined,
      maxAutoTickersPerRun: Number.isFinite(Number(req.body?.maxAutoTickersPerRun))
        ? Number(req.body.maxAutoTickersPerRun)
        : undefined,
      language: req.body?.language === 'en' ? 'en' : req.body?.language === 'cn' ? 'cn' : undefined,
    });
    res.json(pref);
  } catch (error: unknown) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update gainer preferences',
    });
  }
});

/** Admin manual fetch — runs AI gainer pull for current or requested market/period. */
router.post('/fetch', requireAdmin, async (req, res) => {
  try {
    const market = parseMarket(req.body?.market) || 'US';
    const period =
      parsePeriod(req.body?.period, market) || defaultPeriodForMarket(market);
    const fetchAll = req.body?.fetchAll === true;
    const runAutoAnalyze = req.body?.runAutoAnalyze === true;
    const validateQuotes = req.body?.validateQuotes === true;

    console.info('[gainers] manual fetch request', {
      market: fetchAll ? 'ALL' : market,
      period: fetchAll ? 'ALL' : period,
      fetchAll,
      validateQuotes,
      userId: req.user!.id,
    });

    if (market === 'HK') {
      return res.status(400).json({ error: 'HK gainer fetch is not implemented yet' });
    }

    if (manualFetchInFlight) {
      return res.status(409).json({
        error: 'A gainer fetch is already in progress. Please wait for it to finish.',
      });
    }

    const runFetch = async () => {
      const payload = fetchAll
        ? await executeGainerRefresh({ force: true, runAutoAnalyze, validateQuotes })
        : await executeGainerRefresh({ market, period, force: true, runAutoAnalyze, validateQuotes });

      void trackUserEvent({
        userId: req.user!.id,
        eventType: 'gainer_manual_fetch',
        path: '/api/market/gainers/fetch',
        metadata: {
          market: fetchAll ? 'ALL' : market,
          period: fetchAll ? 'ALL' : period,
          jobCount: payload.jobs.length,
        },
      });

      return payload;
    };

    manualFetchInFlight = runFetch();
    try {
      const payload = await manualFetchInFlight;
      res.json({ ok: true, ...(payload as object) });
    } finally {
      manualFetchInFlight = null;
    }
  } catch (error: unknown) {
    console.error('[gainers] manual fetch failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch gainers',
    });
  }
});

router.post('/analyze', requireAdmin, async (req, res) => {
  try {
    const tickers = Array.isArray(req.body?.tickers)
      ? req.body.tickers.map((t: unknown) => String(t).trim()).filter(Boolean)
      : [];
    const language = req.body?.language === 'en' ? 'en' : 'cn';

    if (tickers.length === 0) {
      return res.status(400).json({ error: 'At least one ticker is required' });
    }

    await assertCanAnalyzeCompanies(req.user!.id, tickers.length);

    const batchJob = await withPrismaRetry(
      () =>
        prisma.batchJob.create({
          data: {
            userId: req.user!.id,
            tickers: tickers.join(' '),
            language,
            status: 'PENDING',
            source: 'gainer_manual',
          },
        }),
      'gainers.manualBatchCreate',
      2
    );

    const { jobs } = await addToQueue(tickers, language, batchJob.id, req.user!.id);
    startQueueProcessing();

    void trackUserEvent({
      userId: req.user!.id,
      eventType: 'gainer_manual_analyze',
      path: '/api/market/gainers/analyze',
      metadata: { batchJobId: batchJob.id, tickerCount: tickers.length },
    });

    res.json({
      batchJobId: batchJob.id,
      jobCount: jobs.length,
    });
  } catch (error: unknown) {
    if (error instanceof UsageLimitError) {
      return res.status(429).json({ error: error.message, usage: error.summary });
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start gainer batch analysis',
    });
  }
});

export { router as marketGainersRouter };
