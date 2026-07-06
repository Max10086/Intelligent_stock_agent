import { prisma, withPrismaRetry } from '../db.js';
import { JobStatus } from '@prisma/client';
import type { AnalysisState } from '../../types.js';
import { buildHistoryListSummary } from '../../utils/historyListSummary.js';

/**
 * Queue Management Actions
 * These functions provide a clean interface for queue operations,
 * similar to Server Actions pattern, but for Express backend.
 */

export interface QueueJob {
  id: string;
  userId?: string | null;
  ticker: string;
  companyName?: string | null;
  overallConclusion?: string | null;
  currentPrice?: string | null;
  currency?: string | null;
  estimatedCostUsd?: number | null;
  totalTokens?: number | null;
  query: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  result: any | null;
  reportId?: string | null;
  batchJobId?: string | null;
  progress?: number;
  currentStep?: string | null;
  hasCheckpoint?: boolean;
  logs?: string[] | null;
}

function parseListSummary(summary: string | null | undefined): AnalysisState | null {
  if (!summary) return null;
  try {
    return JSON.parse(summary) as AnalysisState;
  } catch {
    return null;
  }
}

function hasResumeCheckpoint(summary: AnalysisState | null): boolean {
  const focus = summary?.focusCompany;
  if (!focus) return false;
  if (focus.conclusion || focus.finalConclusion) return true;
  const qnaLen = Array.isArray(focus.qna) ? focus.qna.length : 0;
  const qLen = Array.isArray(focus.questions) ? focus.questions.length : 0;
  return qnaLen > 0 && (qLen === 0 || qnaLen >= qLen);
}

function buildStatsFromGroup(
  rows: Array<{ status: JobStatus; _count: { _all: number } }>
): QueueStatus['stats'] {
  const count = (status: JobStatus) =>
    rows.find(row => row.status === status)?._count._all ?? 0;
  return {
    pending: count('PENDING'),
    processing: count('PROCESSING'),
    completed: count('COMPLETED'),
    failed: count('FAILED'),
  };
}

const QUEUE_LIST_SELECT = {
  id: true,
  userId: true,
  ticker: true,
  query: true,
  language: true,
  status: true,
  progress: true,
  currentStep: true,
  logs: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  error: true,
  batchJobId: true,
  listSummary: true,
} as const;

function extractJobSummary(result: any): {
  companyName: string | null;
  overallConclusion: string | null;
  currentPrice: string | null;
  currency: string | null;
  estimatedCostUsd: number | null;
  totalTokens: number | null;
} {
  if (!result || typeof result !== 'object') {
    return {
      companyName: null,
      overallConclusion: null,
      currentPrice: null,
      currency: null,
      estimatedCostUsd: null,
      totalTokens: null,
    };
  }

  const focusCompany = (result as any).focusCompany;
  const companyName =
    typeof focusCompany?.profile?.name === 'string' ? focusCompany.profile.name : null;
  const overallConclusion =
    typeof focusCompany?.finalConclusion?.overall_conclusion === 'string'
      ? focusCompany.finalConclusion.overall_conclusion
      : null;
  const currentPrice =
    typeof focusCompany?.profile?.currentPrice === 'string' ? focusCompany.profile.currentPrice : null;
  const currency =
    typeof focusCompany?.profile?.currency === 'string' ? focusCompany.profile.currency : null;
  const telemetry = Array.isArray((result as any).llmTelemetry) ? (result as any).llmTelemetry : [];
  let estimatedCostUsd = 0;
  let totalTokens = 0;
  for (const entry of telemetry) {
    const usage = entry?.usage;
    if (usage && typeof usage.estimatedCostUsd === 'number' && Number.isFinite(usage.estimatedCostUsd)) {
      estimatedCostUsd += usage.estimatedCostUsd;
    }
    if (usage && typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
      totalTokens += usage.totalTokens;
    }
  }

  return {
    companyName,
    overallConclusion,
    currentPrice,
    currency,
    estimatedCostUsd: telemetry.length ? estimatedCostUsd : null,
    totalTokens: telemetry.length ? totalTokens : null,
  };
}

export interface QueueStatus {
  jobs: QueueJob[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

/**
 * Add tickers to the queue
 * Creates AnalysisJob records with PENDING status for each ticker
 * 
 * @param tickers - Array of ticker symbols or queries
 * @param language - Language for analysis ('en' or 'cn')
 * @param batchJobId - Optional batch job ID to associate these jobs with
 * @returns Array of created job IDs and job details
 */
export async function addToQueue(
  tickers: string[],
  language: string = 'en',
  batchJobId?: string,
  userId?: string
): Promise<{ jobIds: string[]; jobs: QueueJob[] }> {
  if (!tickers || tickers.length === 0) {
    throw new Error('At least one ticker is required');
  }

  // Filter out empty tickers
  const validTickers = tickers
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (validTickers.length === 0) {
    throw new Error('No valid tickers provided');
  }

  try {
    // Create individual analysis jobs for each ticker
    const jobs = await Promise.all(
      validTickers.map(ticker =>
        prisma.analysisJob.create({
          data: {
            batchJobId: batchJobId || null,
            userId: userId || null,
            ticker,
            query: ticker,
            language,
            status: 'PENDING',
          },
        })
      )
    );

    // Transform to QueueJob format
    const queueJobs: QueueJob[] = jobs.map(job => {
      const parsedResult = job.result ? JSON.parse(job.result) : null;
      const { companyName, overallConclusion, currentPrice, currency, estimatedCostUsd, totalTokens } = extractJobSummary(parsedResult);

      return {
        id: job.id,
        userId: job.userId,
        ticker: job.ticker,
        companyName,
        overallConclusion,
        currentPrice,
        currency,
        estimatedCostUsd,
        totalTokens,
        query: job.query,
        status: job.status as JobStatus,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: parsedResult,
        reportId: null, // Can be added later if needed
        batchJobId: job.batchJobId || null,
        progress: job.progress ?? 0,
        currentStep: job.currentStep ?? null,
      };
    });

    return {
      jobIds: jobs.map(j => j.id),
      jobs: queueJobs,
    };
  } catch (error: any) {
    console.error('Error adding jobs to queue:', error);
    throw new Error(`Failed to add jobs to queue: ${error.message}`);
  }
}

/**
 * Get queue status
 * Fetches all jobs, ordered by createdAt desc
 * Returns their status and associated reportId
 * 
 * @param options - Optional filters and pagination
 * @returns Queue status with jobs and statistics
 */
export async function getQueueStatus(options?: {
  status?: JobStatus;
  limit?: number;
  offset?: number;
  batchJobId?: string;
  userId?: string;
}): Promise<QueueStatus> {
  try {
    const where: any = {};

    if (options?.userId) {
      where.userId = options.userId;
    }

    // Filter by status if provided
    if (options?.status) {
      where.status = options.status;
    }

    // Filter by batch job ID if provided
    if (options?.batchJobId) {
      where.batchJobId = options.batchJobId;
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // Sequential: parallel findMany + groupBy doubles pool usage and caused P2024 under load.
    const jobs = await withPrismaRetry(
      () =>
        prisma.analysisJob.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          select: QUEUE_LIST_SELECT,
        }),
      'queue.list',
      3
    );
    const statusGroups = await withPrismaRetry(
      () =>
        prisma.analysisJob.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
      'queue.stats',
      2
    );

    const stats = buildStatsFromGroup(statusGroups);
    const total = statusGroups.reduce((sum, row) => sum + row._count._all, 0);

    const queueJobs: QueueJob[] = jobs.map(job => {
      const parsedSummary = parseListSummary(job.listSummary);
      const { companyName, overallConclusion, currentPrice, currency, estimatedCostUsd, totalTokens } =
        extractJobSummary(parsedSummary);

      return {
        id: job.id,
        userId: job.userId,
        ticker: job.ticker,
        companyName,
        overallConclusion,
        currentPrice,
        currency,
        estimatedCostUsd,
        totalTokens,
        query: job.query,
        status: job.status as JobStatus,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: null,
        reportId: null,
        batchJobId: job.batchJobId || null,
        progress: job.progress ?? 0,
        currentStep: job.currentStep ?? null,
        hasCheckpoint: hasResumeCheckpoint(parsedSummary),
        logs: job.logs ? JSON.parse(job.logs) : null,
      };
    });

    return {
      jobs: queueJobs,
      total,
      stats,
    };
  } catch (error: any) {
    console.error('Error getting queue status:', error);
    throw new Error(`Failed to get queue status: ${error.message}`);
  }
}

/**
 * Get a single job by ID
 * 
 * @param jobId - Job ID
 * @returns Job details or null if not found
 */
export async function getJobById(jobId: string): Promise<QueueJob | null> {
  try {
    const job = await prisma.analysisJob.findUnique({
      where: { id: jobId },
      include: {
        batchJob: {
          select: {
            id: true,
            tickers: true,
          },
        },
      },
    });

    if (!job) {
      return null;
    }

    const parsedResult = job.result ? JSON.parse(job.result) : null;
    const { companyName, overallConclusion, currentPrice, currency, estimatedCostUsd, totalTokens } = extractJobSummary(parsedResult);

    return {
      id: job.id,
      userId: job.userId,
      ticker: job.ticker,
      companyName,
      overallConclusion,
      currentPrice,
      currency,
      estimatedCostUsd,
      totalTokens,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: parsedResult,
      reportId: null,
      batchJobId: job.batchJobId || null,
      progress: job.progress ?? 0,
      currentStep: job.currentStep ?? null,
      logs: job.logs ? JSON.parse(job.logs) : null,
    };
  } catch (error: any) {
    console.error('Error getting job by ID:', error);
    throw new Error(`Failed to get job: ${error.message}`);
  }
}

export async function retryFailedJob(jobId: string, userId: string): Promise<QueueJob> {
  const job = await prisma.analysisJob.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) {
    throw new Error('Job not found');
  }
  if (job.status !== 'FAILED') {
    throw new Error('Only failed jobs can be retried');
  }

  const hasCheckpoint = Boolean(job.result);
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      error: null,
      completedAt: null,
      startedAt: null,
      currentStep: hasCheckpoint ? 'Queued — resume from checkpoint' : 'Queued for retry',
    },
  });

  const updated = await getJobById(jobId);
  if (!updated) {
    throw new Error('Job not found after retry');
  }
  return updated;
}

/**
 * Update job status
 * 
 * @param jobId - Job ID
 * @param updates - Status updates
 */
export async function updateJobStatus(
  jobId: string,
  updates: {
    status?: JobStatus;
    error?: string | null;
    result?: any;
    startedAt?: Date | null;
    completedAt?: Date | null;
    progress?: number;
    currentStep?: string | null;
    logs?: string[];
  }
): Promise<QueueJob> {
  try {
    const updateData: any = {};

    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }
    if (updates.error !== undefined) {
      updateData.error = updates.error;
    }
    if (updates.result !== undefined) {
      updateData.result = JSON.stringify(updates.result);
      updateData.listSummary = buildHistoryListSummary(updates.result as AnalysisState);
    }
    if (updates.startedAt !== undefined) {
      updateData.startedAt = updates.startedAt;
    }
    if (updates.completedAt !== undefined) {
      updateData.completedAt = updates.completedAt;
    }
    if (updates.progress !== undefined) {
      updateData.progress = Math.max(0, Math.min(100, updates.progress));
    }
    if (updates.currentStep !== undefined) {
      updateData.currentStep = updates.currentStep;
    }
    if (updates.logs !== undefined) {
      // Get existing logs and append new ones
      const existingJob = await prisma.analysisJob.findUnique({
        where: { id: jobId },
        select: { logs: true },
      });
      const existingLogs = existingJob?.logs ? JSON.parse(existingJob.logs) : [];
      const updatedLogs = [...existingLogs, ...updates.logs];
      updateData.logs = JSON.stringify(updatedLogs);
    }

    const job = await prisma.analysisJob.update({
      where: { id: jobId },
      data: updateData,
    });

    const parsedResult = job.result ? JSON.parse(job.result) : null;
    const { companyName, overallConclusion, currentPrice, currency, estimatedCostUsd, totalTokens } = extractJobSummary(parsedResult);

    return {
      id: job.id,
      ticker: job.ticker,
      companyName,
      overallConclusion,
      currentPrice,
      currency,
      estimatedCostUsd,
      totalTokens,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: parsedResult,
      reportId: null,
      batchJobId: job.batchJobId || null,
      progress: job.progress ?? 0,
      currentStep: job.currentStep ?? null,
      logs: job.logs ? JSON.parse(job.logs) : null,
    };
  } catch (error: any) {
    console.error('Error updating job status:', error);
    throw new Error(`Failed to update job status: ${error.message}`);
  }
}
