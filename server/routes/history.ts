import express from 'express';
import { prisma, withPrismaRetry } from '../db.js';
import { AnalysisState } from '../../types.js';
import { buildHistoryListSummary } from '../../utils/historyListSummary.js';
import { requireAuth, requireAuthLite } from '../middleware/auth.js';
import { trackUserEvent } from '../services/analytics.js';

const router = express.Router();
const HISTORY_LOAD_TIMEOUT_MS = Number(process.env.HISTORY_LOAD_TIMEOUT_MS) || 45_000;
const HISTORY_CACHE_TTL_MS = Number(process.env.HISTORY_CACHE_TTL_MS) || 120_000;
const HISTORY_FIRST_PAGE_SIZE = Number(process.env.HISTORY_FIRST_PAGE_SIZE) || 12;

let historyListPromises = new Map<string, Promise<AnalysisState[]>>();
const historyListCache = new Map<string, { expiresAt: number; data: AnalysisState[] }>();

export function invalidateHistoryListCache(userId?: string): void {
  if (userId) {
    historyListCache.delete(userId);
    historyListPromises.delete(userId);
    return;
  }
  historyListCache.clear();
  historyListPromises.clear();
}

function getCachedHistory(userId: string): AnalysisState[] | null {
  const entry = historyListCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    historyListCache.delete(userId);
    return null;
  }
  return entry.data;
}

function setCachedHistory(userId: string, data: AnalysisState[]): void {
  historyListCache.set(userId, {
    data,
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isLikelyCorruptedReport(result: AnalysisState): boolean {
  const allCompanies = [
    result.focusCompany,
    ...(result.candidateCompanies || []),
  ].filter(Boolean);

  const allQna = allCompanies.flatMap((company) => company?.qna || []);
  if (allQna.length === 0) return false;

  const questionPatternCount = allQna.filter((item) => /^Q\d+$/i.test(item.question?.trim() || '')).length;
  const repeatedCharCount = allQna.filter((item) => /(.)\1{200,}/.test(item.answer || '')).length;

  return questionPatternCount === allQna.length || repeatedCharCount > Math.floor(allQna.length / 2);
}

function parseSummaryToAnalysisState(
  job: {
    id: string;
    ticker: string;
    query: string;
    language: string;
    completedAt: Date | null;
  },
  summaryJson: string
): AnalysisState | null {
  try {
    const result: AnalysisState = JSON.parse(summaryJson);
    if (isLikelyCorruptedReport(result)) {
      console.warn(`Skipping corrupted history payload for job ${job.id}`);
      return null;
    }
    return {
      ...result,
      id: job.id,
      clientSessionId:
        (typeof result.clientSessionId === 'string' && result.clientSessionId.trim()) ||
        (typeof result.id === 'string' && result.id.trim()) ||
        job.id,
      timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
      status:
        result.status === 'partial' || result.status === 'analyzing' || result.status === 'error'
          ? result.status
          : 'complete',
      language: (job.language as 'en' | 'cn') || result.language || 'en',
      query: job.query || job.ticker,
    };
  } catch (error) {
    console.error(`Error parsing summary for job ${job.id}:`, error);
    return null;
  }
}

function parseJobToAnalysisState(job: {
  id: string;
  ticker: string;
  query: string;
  language: string;
  completedAt: Date | null;
  result: string;
}): AnalysisState | null {
  try {
    const result: AnalysisState = JSON.parse(job.result);
    if (isLikelyCorruptedReport(result)) {
      console.warn(`Skipping corrupted history payload for job ${job.id}`);
      return null;
    }
    return {
      ...result,
      id: job.id,
      clientSessionId:
        (typeof result.clientSessionId === 'string' && result.clientSessionId.trim()) ||
        (typeof result.id === 'string' && result.id.trim()) ||
        job.id,
      timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
      status:
        result.status === 'partial' || result.status === 'analyzing' || result.status === 'error'
          ? result.status
          : 'complete',
      language: (job.language as 'en' | 'cn') || 'en',
      query: job.query || job.ticker,
    };
  } catch (error) {
    console.error(`Error parsing result for job ${job.id}:`, error);
    return null;
  }
}

function dedupeHistoryByJobId(history: AnalysisState[]): AnalysisState[] {
  const byId = new Map<string, AnalysisState>();
  for (const item of history) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

async function loadHistoryPageFromDb(
  userId: string,
  limit: number,
  offset: number,
  options?: { includeTotal?: boolean }
): Promise<{ history: AnalysisState[]; total?: number; hasMore: boolean }> {
  const includeTotal = options?.includeTotal ?? true;
  const take = includeTotal ? limit : limit + 1;

  // listSummary only — never read multi-MB `result` blobs for sidebar list (major latency win).
  const rows = await withPrismaRetry(
    () =>
      prisma.analysisJob.findMany({
        where: {
          status: 'COMPLETED',
          userId,
          listSummary: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        skip: offset,
        take,
        select: {
          id: true,
          ticker: true,
          query: true,
          language: true,
          completedAt: true,
          listSummary: true,
        },
      }),
    'history.list',
    3
  );

  const hasMoreWithoutCount = !includeTotal && rows.length > limit;
  const pageRows = hasMoreWithoutCount ? rows.slice(0, limit) : rows;
  const total = includeTotal
    ? await withPrismaRetry(
        () =>
          prisma.analysisJob.count({
            where: { status: 'COMPLETED', userId, listSummary: { not: null } },
          }),
        'history.count',
        2
      )
    : undefined;

  const history: AnalysisState[] = [];
  for (const row of pageRows) {
    if (!row.listSummary) continue;
    const parsed = parseSummaryToAnalysisState(row, row.listSummary);
    if (parsed) {
      history.push(parsed);
    }
  }

  return {
    history: dedupeHistoryByJobId(history),
    total,
    hasMore: includeTotal ? offset + pageRows.length < (total || 0) : hasMoreWithoutCount,
  };
}

async function loadHistoryFromDb(userId: string): Promise<AnalysisState[]> {
  const cached = getCachedHistory(userId);
  if (cached) {
    return cached;
  }

  const maxItems = Number(process.env.HISTORY_MAX_ITEMS) || 50;
  const { history } = await loadHistoryPageFromDb(userId, maxItems, 0, { includeTotal: false });
  setCachedHistory(userId, history);
  return history;
}

/**
 * POST /api/history
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { result, query, language = 'en' } = req.body;

    if (!result || !query) {
      return res.status(400).json({
        error: 'result and query are required',
      });
    }

    const ticker = result.focusCompany?.profile?.ticker || query.split(' ')[0].toUpperCase();

    const listSummary = buildHistoryListSummary(result);

    const sessionId = typeof result.id === 'string' ? result.id.trim() : '';
    const clientSessionId =
      typeof result.clientSessionId === 'string' ? result.clientSessionId.trim() : sessionId;
    if (sessionId || clientSessionId) {
      const lookupId = sessionId || clientSessionId;
      const existing = await withPrismaRetry(
        () =>
          prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM "AnalysisJob"
             WHERE status = 'COMPLETED' AND result IS NOT NULL AND "userId" = $2
               AND (
                 result::jsonb->>'id' = $1
                 OR result::jsonb->>'clientSessionId' = $1
               )
             ORDER BY "completedAt" DESC
             LIMIT 1`,
            lookupId,
            userId
          ),
        'history.create.dedup'
      );
      if (existing.length > 0) {
        const jobId = existing[0].id;
        await withPrismaRetry(
          () =>
            prisma.analysisJob.update({
              where: { id: jobId },
              data: {
                ticker,
                query,
                language,
                status: 'COMPLETED',
                completedAt: new Date(),
                progress: result.status === 'partial' ? 80 : 100,
                currentStep:
                  result.status === 'partial' ? 'Focus report saved' : 'Analysis Complete',
                result: JSON.stringify(result),
                listSummary,
              },
            }),
          'history.create.update'
        );
        historyListPromises.delete(userId);
        invalidateHistoryListCache(userId);
        return res.json({
          success: true,
          message: 'Report updated successfully',
          jobId,
          updated: true,
        });
      }
    }

    const job = await withPrismaRetry(() => prisma.analysisJob.create({
      data: {
        userId,
        ticker,
        query,
        language,
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        progress: 100,
        currentStep: 'Analysis Complete',
        result: JSON.stringify(result),
        listSummary,
      },
    }), 'history.create');

    historyListPromises.delete(userId);
    invalidateHistoryListCache(userId);

    await trackUserEvent({
      userId,
      eventType: 'analysis_complete',
      metadata: { jobId: job.id, ticker, query },
    });

    res.json({
      success: true,
      message: 'Report saved successfully',
      jobId: job.id,
    });
  } catch (error: any) {
    console.error('Error saving report:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to save report',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

/**
 * GET /api/history
 */
router.get('/', requireAuthLite, async (req, res) => {
  try {
    const userId = req.user!.id;
    const maxItems = Number(process.env.HISTORY_MAX_ITEMS) || 50;
    const limit = Math.min(Math.max(Number(req.query.limit) || maxItems, 1), maxItems);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const wantsFullList = limit >= maxItems && offset === 0;

    if (wantsFullList) {
      const cached = getCachedHistory(userId);
      if (cached) {
        return res.json({ history: cached, total: cached.length, cached: true });
      }

      if (!historyListPromises.has(userId)) {
        historyListPromises.set(
          userId,
          withTimeout(loadHistoryFromDb(userId), HISTORY_LOAD_TIMEOUT_MS, 'History load').finally(
            () => {
              historyListPromises.delete(userId);
            }
          )
        );
      }

      const history = await historyListPromises.get(userId)!;
      return res.json({
        history,
        total: history.length,
      });
    }

    const includeTotal = req.query.includeTotal === 'true';
    const { history, total, hasMore } = await withTimeout(
      loadHistoryPageFromDb(userId, limit, offset, { includeTotal }),
      HISTORY_LOAD_TIMEOUT_MS,
      'History page load'
    );
    const estimatedTotal = total ?? offset + history.length + (hasMore ? 1 : 0);

    res.json({
      history,
      total: estimatedTotal,
      hasMore,
      limit,
      offset,
    });
  } catch (error: any) {
    historyListPromises.delete(req.user!.id);
    console.error('Error fetching history:', error);
    if (!res.headersSent) {
      const timedOut = /timed out/i.test(error?.message || '');
      res.status(timedOut ? 503 : 500).json({
        error: timedOut
          ? 'History load timed out — database may be busy. Retry in a few seconds.'
          : 'Failed to fetch history',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

/**
 * GET /api/history/:id — full report with Q&A
 */
router.get('/:id', requireAuthLite, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const job = await withPrismaRetry(
      () =>
        prisma.analysisJob.findFirst({
          where: { id, userId },
          select: {
            id: true,
            ticker: true,
            query: true,
            language: true,
            completedAt: true,
            result: true,
            status: true,
          },
        }),
      'history.getOne',
      2
    );

    if (!job || job.status !== 'COMPLETED' || !job.result) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const parsed = parseJobToAnalysisState({
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      language: job.language,
      completedAt: job.completedAt,
      result: job.result,
    });

    if (!parsed) {
      return res.status(404).json({ error: 'Report not found or corrupted' });
    }

    void trackUserEvent({
      userId,
      eventType: 'report_open',
      metadata: { reportId: id, ticker: job.ticker },
    });

    res.json({ report: parsed });
  } catch (error: any) {
    console.error('Error fetching report:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to fetch report',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

/**
 * DELETE /api/history/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.analysisJob.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const deleted = await prisma.analysisJob.delete({
      where: { id },
    });

    historyListPromises.delete(userId);
    invalidateHistoryListCache(userId);

    res.json({
      success: true,
      message: 'Report deleted successfully',
      deletedId: deleted.id,
    });
  } catch (error: any) {
    console.error('Error deleting report:', error);
    if (!res.headersSent) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Report not found' });
      } else {
        res.status(500).json({
          error: 'Failed to delete report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
      }
    }
  }
});

/**
 * DELETE /api/history
 */
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const result = await prisma.analysisJob.deleteMany({
      where: { status: 'COMPLETED', userId },
    });

    historyListPromises.delete(userId);
    invalidateHistoryListCache(userId);

    res.json({
      success: true,
      message: 'All history cleared',
      deletedCount: result.count,
    });
  } catch (error: any) {
    console.error('Error clearing history:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to clear history',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

export { router as historyRouter };
