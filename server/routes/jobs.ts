import express from 'express';
import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { addToQueue, getQueueStatus, getJobById, retryFailedJob } from '../actions/queue.js';
import { listAnalysisCatalog } from '../services/analysisCatalogService.js';
import { computeCatalogReturns } from '../services/catalogReturnService.js';
import { startQueueProcessing, resetStaleProcessingJobs } from '../actions/process.js';
import { assertCanAnalyzeCompanies, UsageLimitError } from '../services/usageLimit.js';
import { trackUserEvent } from '../services/analytics.js';

const router = express.Router();

// POST /api/jobs/batch - Create a new batch job
router.post('/batch', async (req, res) => {
  let requestedCompanies = 0;
  try {
    const userId = req.user!.id;
    const { tickers, language = 'en' } = req.body;

    if (!tickers || typeof tickers !== 'string') {
      return res.status(400).json({
        error: 'tickers is required and must be a string (space or comma-separated)'
      });
    }

    // Parse tickers/queries - support both space and comma separated
    // Split by comma or whitespace, then filter empty strings
    const tickerList = tickers
      .split(/[,\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);
    requestedCompanies = tickerList.length;

    if (tickerList.length === 0) {
      return res.status(400).json({
        error: 'At least one ticker/query is required'
      });
    }

    await assertCanAnalyzeCompanies(userId, tickerList.length);

    const batchJob = await prisma.batchJob.create({
      data: {
        userId,
        tickers,
        language,
        status: 'PENDING',
      },
    });

    const { jobIds, jobs } = await addToQueue(tickerList, language, batchJob.id, userId);

    void trackUserEvent({
      userId,
      eventType: 'batch_start',
      path: '/api/jobs/batch',
      metadata: { batchJobId: batchJob.id, tickerCount: tickerList.length },
    });

    // Trigger background processing (Fire-and-Forget)
    // This allows the HTTP request to return immediately
    startQueueProcessing();

    res.json({
      batchJobId: batchJob.id,
      jobCount: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        ticker: j.ticker,
        companyName: j.companyName ?? null,
        status: j.status,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        progress: j.progress ?? 0,
        currentStep: j.currentStep ?? null,
        overallConclusion: null,
        currentPrice: null,
        currency: null,
        estimatedCostUsd: null,
        totalTokens: null,
        result: null,
      })),
      message: 'Batch job created. Background processing started.',
    });
  } catch (error: any) {
    console.error('Error creating batch job:', error);
    if (error instanceof UsageLimitError) {
      void trackUserEvent({
        userId: req.user!.id,
        eventType: 'usage_limit_hit',
        path: '/api/jobs/batch',
        metadata: { requestedCompanies },
      });
      return res.status(429).json({
        error: error.message,
        usage: error.summary,
      });
    }
    // Ensure we always send a valid JSON response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to create batch job',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// GET /api/jobs/batch/:id - Get batch job status
router.get('/batch/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const batchJob = await prisma.batchJob.findFirst({
      where: { id, userId: req.user!.id },
      include: {
        jobs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batchJob) {
      return res.status(404).json({ error: 'Batch job not found' });
    }

    // Calculate overall status
    const jobStatuses = batchJob.jobs.map(j => j.status);
    let overallStatus: JobStatus = 'PENDING';
    
    if (jobStatuses.every(s => s === 'COMPLETED')) {
      overallStatus = 'COMPLETED';
    } else if (jobStatuses.some(s => s === 'FAILED')) {
      overallStatus = 'FAILED';
    } else if (jobStatuses.some(s => s === 'PROCESSING' || s === 'COMPLETED')) {
      overallStatus = 'PROCESSING';
    }

    res.json({
      ...batchJob,
      overallStatus,
      stats: {
        total: batchJob.jobs.length,
        pending: jobStatuses.filter(s => s === 'PENDING').length,
        processing: jobStatuses.filter(s => s === 'PROCESSING').length,
        completed: jobStatuses.filter(s => s === 'COMPLETED').length,
        failed: jobStatuses.filter(s => s === 'FAILED').length,
      },
    });
  } catch (error: any) {
    console.error('Error fetching batch job:', error);
    // Ensure we always send a valid JSON response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to fetch batch job',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// POST /api/jobs/:id/retry - Re-queue a failed job (resumes from checkpoint if available)
router.post('/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const job = await retryFailedJob(id, userId);
    const processingCount = await prisma.analysisJob.count({ where: { status: 'PROCESSING' } });
    if (processingCount >= 2) {
      await resetStaleProcessingJobs(90_000);
    }
    startQueueProcessing();

    res.json({
      success: true,
      message: job.result
        ? 'Job re-queued — will resume from last checkpoint'
        : 'Job re-queued from the beginning',
      job,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to retry job';
    const status = /not found/i.test(message) ? 404 : /only failed/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// GET /api/jobs/catalog - Completed analyses grouped by conclusion (for browse page)
router.get('/catalog', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10);
    const offset = parseInt(req.query.offset as string, 10);
    const includeTotal = req.query.includeTotal === 'true';
    const catalog = await listAnalysisCatalog(req.user!.id, {
      limit: Number.isFinite(limit) ? limit : 60,
      offset: Number.isFinite(offset) ? offset : 0,
      includeTotal,
    });
    res.json(catalog);
  } catch (error: any) {
    console.error('Error listing analysis catalog:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to list analysis catalog',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// POST /api/jobs/catalog/returns - Live cumulative return vs analysis-day baseline price
router.post('/catalog/returns', async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .map((row: unknown) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Record<string, unknown>;
        const id = String(item.id || '').trim();
        const ticker = String(item.ticker || '').trim();
        const exchange = String(item.exchange || 'NASDAQ').trim() || 'NASDAQ';
        const anchorPrice = String(item.anchorPrice || '').trim();
        const companyName = String(item.companyName || '').trim() || null;
        if (!id || !ticker || !anchorPrice) return null;
        return { id, ticker, exchange, anchorPrice, companyName };
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{
      id: string;
      ticker: string;
      exchange: string;
      anchorPrice: string;
      companyName: string | null;
    }>;

    if (items.length === 0) {
      return res.json({ results: [] });
    }

    const results = await computeCatalogReturns(items);
    res.json({ results });
  } catch (error: unknown) {
    console.error('Error computing catalog returns:', error);
    res.status(500).json({
      error: 'Failed to compute catalog returns',
      details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
    });
  }
});

// GET /api/jobs/:id - Get individual job status and result
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const job = await getJobById(id);

    if (!job || job.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error: any) {
    console.error('Error fetching job:', error);
    // Ensure we always send a valid JSON response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to fetch job',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// GET /api/jobs - List all jobs (with pagination)
// Uses getQueueStatus action
router.get('/', async (req, res) => {
  try {
    const { status, limit = '50', offset = '0', batchJobId } = req.query;

    const options: {
      status?: JobStatus;
      limit?: number;
      offset?: number;
      batchJobId?: string;
    } = {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    };

    if (status && ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(status as string)) {
      options.status = status as JobStatus;
    }

    if (batchJobId) {
      options.batchJobId = batchJobId as string;
    }

    const queueStatus = await getQueueStatus({
      ...options,
      userId: req.user!.id,
    });

    res.json({
      jobs: queueStatus.jobs,
      total: queueStatus.total,
      stats: queueStatus.stats,
      limit: options.limit,
      offset: options.offset,
    });
  } catch (error: any) {
    console.error('Error listing jobs:', error);
    // Ensure we always send a valid JSON response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to list jobs',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// POST /api/jobs/process - Manually trigger queue processing
router.post('/process', async (req, res) => {
  try {
    // Fire-and-Forget: Start processing without awaiting
    startQueueProcessing();
    
    res.json({
      message: 'Queue processing started in background',
      status: 'processing',
    });
  } catch (error: any) {
    console.error('Error starting queue processing:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to start queue processing',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

export { router as jobsRouter };
