import { prisma } from '../db.js';
import { JobStatus } from '@prisma/client';

/**
 * Queue Management Actions
 * These functions provide a clean interface for queue operations,
 * similar to Server Actions pattern, but for Express backend.
 */

export interface QueueJob {
  id: string;
  ticker: string;
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
  logs?: string[] | null;
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
  batchJobId?: string
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
            ticker,
            query: ticker,
            language,
            status: 'PENDING',
          },
        })
      )
    );

    // Transform to QueueJob format
    const queueJobs: QueueJob[] = jobs.map(job => ({
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result ? JSON.parse(job.result) : null,
      reportId: null, // Can be added later if needed
      batchJobId: job.batchJobId || null,
    }));

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
}): Promise<QueueStatus> {
  try {
    const where: any = {};

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

    // Fetch jobs ordered by createdAt desc
    const [jobs, total] = await Promise.all([
      prisma.analysisJob.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          batchJob: {
            select: {
              id: true,
              tickers: true,
            },
          },
        },
      }),
      prisma.analysisJob.count({ where }),
    ]);

    // Transform to QueueJob format
    const queueJobs: QueueJob[] = jobs.map(job => ({
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result ? JSON.parse(job.result) : null,
      reportId: null, // Can be added later if reportId field exists
      batchJobId: job.batchJobId || null,
      progress: job.progress ?? 0,
      currentStep: job.currentStep ?? null,
      logs: job.logs ? JSON.parse(job.logs) : null,
    }));

    // Calculate statistics
    const stats = {
      pending: queueJobs.filter(j => j.status === 'PENDING').length,
      processing: queueJobs.filter(j => j.status === 'PROCESSING').length,
      completed: queueJobs.filter(j => j.status === 'COMPLETED').length,
      failed: queueJobs.filter(j => j.status === 'FAILED').length,
    };

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

    return {
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result ? JSON.parse(job.result) : null,
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

    return {
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      status: job.status as JobStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result ? JSON.parse(job.result) : null,
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
