import express from 'express';
import { prisma, resetPrismaConnection, withPrismaRetry } from '../db.js';
import { AnalysisState } from '../../types.js';
import { slimHistoryItem } from '../../utils/historyListSummary.js';
import { dedupeHistoryBySession } from '../../utils/analysisTimeline.js';

const router = express.Router();
const HISTORY_LOAD_TIMEOUT_MS = Number(process.env.HISTORY_LOAD_TIMEOUT_MS) || 45_000;

let historyListPromise: Promise<AnalysisState[]> | null = null;

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
      clientSessionId: typeof result.id === 'string' ? result.id : job.id,
      timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
      status: 'complete' as const,
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
      clientSessionId: typeof result.id === 'string' ? result.id : job.id,
      timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
      status: 'complete' as const,
      language: (job.language as 'en' | 'cn') || 'en',
      query: job.query || job.ticker,
    };
  } catch (error) {
    console.error(`Error parsing result for job ${job.id}:`, error);
    return null;
  }
}

type HistoryListRow = {
  id: string;
  ticker: string;
  query: string;
  language: string;
  completedAt: Date | null;
  summary: string | null;
};

const HISTORY_LIST_SQL = `
  SELECT
    j.id,
    j.ticker,
    j.query,
    j.language,
    j."completedAt",
    (
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'id', r->'id',
        'focusCompany',
          CASE
            WHEN jsonb_typeof(r->'focusCompany') = 'object' THEN
              (r->'focusCompany') - 'qna' || jsonb_build_object('qna', '[]'::jsonb)
          END,
        'candidateCompanies',
          (
            SELECT COALESCE(
              jsonb_agg(
                CASE
                  WHEN jsonb_typeof(elem) = 'object' THEN
                    (elem - 'qna') || jsonb_build_object('qna', '[]'::jsonb)
                  ELSE elem
                END
              ),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(r->'candidateCompanies') = 'array' THEN r->'candidateCompanies'
                ELSE '[]'::jsonb
              END
            ) AS elem
          ),
        'analysisType', r->'analysisType',
        'parentAnalysisId', r->'parentAnalysisId',
        'followUpMeta', r->'followUpMeta'
      ))::text
    ) AS summary
  FROM "AnalysisJob" j
  CROSS JOIN LATERAL (SELECT j.result::jsonb AS r) AS parsed
  WHERE j.status = 'COMPLETED' AND j.result IS NOT NULL
  ORDER BY j."completedAt" DESC
  LIMIT $1
`;

async function loadHistoryFromDbFallback(maxItems: number): Promise<AnalysisState[]> {
  const rows = await withPrismaRetry(
    () =>
      prisma.analysisJob.findMany({
        where: { status: 'COMPLETED', result: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: maxItems,
        select: {
          id: true,
          ticker: true,
          query: true,
          language: true,
          completedAt: true,
          result: true,
        },
      }),
    'history.fallback',
    3
  );

  const history: AnalysisState[] = [];
  for (const row of rows) {
    if (!row.result) continue;
    const parsed = parseJobToAnalysisState({
      id: row.id,
      ticker: row.ticker,
      query: row.query,
      language: row.language,
      completedAt: row.completedAt,
      result: row.result,
    });
    if (parsed) {
      history.push(slimHistoryItem(parsed));
    }
  }
  return dedupeHistoryBySession(history);
}

async function loadHistoryFromDb(): Promise<AnalysisState[]> {
  const maxItems = Number(process.env.HISTORY_MAX_ITEMS) || 50;

  // Fresh client helps recover after HMR restarts left stale pooler sessions.
  await resetPrismaConnection();

  try {
    const rows = await withPrismaRetry(
      () => prisma.$queryRawUnsafe<HistoryListRow[]>(HISTORY_LIST_SQL, maxItems),
      'history.list',
      3
    );

    const history: AnalysisState[] = [];
    for (const row of rows) {
      if (!row.summary) continue;
      const parsed = parseSummaryToAnalysisState(row, row.summary);
      if (parsed) {
        history.push(parsed);
      }
    }
    return dedupeHistoryBySession(history);
  } catch (error) {
    console.warn('SQL history list failed, falling back to in-process slim parse:', error);
    return loadHistoryFromDbFallback(maxItems);
  }
}

/**
 * POST /api/history
 */
router.post('/', async (req, res) => {
  try {
    const { result, query, language = 'en' } = req.body;

    if (!result || !query) {
      return res.status(400).json({
        error: 'result and query are required',
      });
    }

    const ticker = result.focusCompany?.profile?.ticker || query.split(' ')[0].toUpperCase();

    const sessionId = typeof result.id === 'string' ? result.id.trim() : '';
    if (sessionId) {
      const existing = await withPrismaRetry(
        () =>
          prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM "AnalysisJob"
             WHERE status = 'COMPLETED' AND result IS NOT NULL
               AND result::jsonb->>'id' = $1
             ORDER BY "completedAt" DESC
             LIMIT 1`,
            sessionId
          ),
        'history.create.dedup'
      );
      if (existing.length > 0) {
        historyListPromise = null;
        return res.json({
          success: true,
          message: 'Report already saved',
          jobId: existing[0].id,
          deduplicated: true,
        });
      }
    }

    const job = await withPrismaRetry(() => prisma.analysisJob.create({
      data: {
        ticker,
        query,
        language,
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        progress: 100,
        currentStep: 'Analysis Complete',
        result: JSON.stringify(result),
      },
    }), 'history.create');

    historyListPromise = null;

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
router.get('/', async (_req, res) => {
  try {
    if (!historyListPromise) {
      historyListPromise = withTimeout(
        loadHistoryFromDb(),
        HISTORY_LOAD_TIMEOUT_MS,
        'History load'
      ).finally(() => {
        historyListPromise = null;
      });
    }

    const history = await historyListPromise;

    res.json({
      history,
      total: history.length,
    });
  } catch (error: any) {
    historyListPromise = null;
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
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await withPrismaRetry(
      () =>
        prisma.analysisJob.findUnique({
          where: { id },
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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await prisma.analysisJob.delete({
      where: { id },
    });

    historyListPromise = null;

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
router.delete('/', async (_req, res) => {
  try {
    const result = await prisma.analysisJob.deleteMany({
      where: { status: 'COMPLETED' },
    });

    historyListPromise = null;

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
