import express from 'express';
import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';
import { addToQueue, getQueueStatus, getJobById } from '../actions/queue.js';
import { startQueueProcessing } from '../actions/process.js';

const router = express.Router();

// POST /api/jobs/batch - Create a new batch job
router.post('/batch', async (req, res) => {
  try {
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

    if (tickerList.length === 0) {
      return res.status(400).json({
        error: 'At least one ticker/query is required'
      });
    }

    // Create batch job
    const batchJob = await prisma.batchJob.create({
      data: {
        tickers,
        language,
        status: 'PENDING',
      },
    });

    // Use queue action to create jobs
    const { jobIds, jobs } = await addToQueue(tickerList, language, batchJob.id);

    // Trigger background processing (Fire-and-Forget)
    // This allows the HTTP request to return immediately
    startQueueProcessing();

    res.json({
      batchJobId: batchJob.id,
      jobCount: jobs.length,
      jobs: jobs.map(j => ({ id: j.id, ticker: j.ticker })),
      message: 'Batch job created. Background processing started.',
    });
  } catch (error: any) {
    console.error('Error creating batch job:', error);
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

    const batchJob = await prisma.batchJob.findUnique({
      where: { id },
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

// GET /api/jobs/:id - Get individual job status and result
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const job = await getJobById(id);

    if (!job) {
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

    const queueStatus = await getQueueStatus(options);

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
