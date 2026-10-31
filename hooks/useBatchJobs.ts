import { useState, useCallback, useEffect, useRef } from 'react';
import { Language, AnalysisState } from '../types.ts';
import { apiFetch, getAuthToken, readApiError } from '../utils/authenticatedFetch.ts';

const QUEUE_CACHE_KEY = 'intelligent-stock-agent:batch-queue-v2';
const QUEUE_POLL_MS = 15000;
const QUEUE_POLL_ACTIVE_MS = 5000;

export interface QueueJobItem {
  id: string;
  ticker: string;
  companyName?: string | null;
  overallConclusion?: string | null;
  currentPrice?: string | null;
  currency?: string | null;
  estimatedCostUsd?: number | null;
  totalTokens?: number | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  result: AnalysisState | null;
  progress?: number;
  currentStep?: string | null;
  error?: string | null;
  hasCheckpoint?: boolean;
  logs?: string[] | null;
}

export interface QueueDashboardState {
  jobs: QueueJobItem[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

interface BatchJobStatus {
  batchJobId: string;
  overallStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stats: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  jobs: Array<{
    id: string;
    ticker: string;
    status: string;
    result?: unknown;
  }>;
}

export interface BatchSubmitResult {
  batchJobId: string;
  jobCount: number;
  jobs: QueueJobItem[];
}

const parseErrorResponse = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return (data as { error?: string }).error || `HTTP error! status: ${response.status}`;
  } catch {
    return (await response.text()) || `HTTP error! status: ${response.status}`;
  }
};

function readQueueCache(): QueueDashboardState | null {
  try {
    const raw = sessionStorage.getItem(QUEUE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QueueDashboardState;
  } catch {
    return null;
  }
}

function writeQueueCache(status: QueueDashboardState) {
  try {
    sessionStorage.setItem(QUEUE_CACHE_KEY, JSON.stringify(status));
  } catch {
    // ignore quota / private mode
  }
}

function reconcileFailedJobState(job: QueueJobItem): QueueJobItem {
  const failedPrefix = job.currentStep?.startsWith('Failed:');
  const hasError = Boolean(job.error?.trim());

  if (job.status === 'FAILED') {
    return job;
  }

  if (hasError || failedPrefix) {
    return {
      ...job,
      status: 'FAILED',
      error: job.error ?? (failedPrefix ? job.currentStep!.replace(/^Failed:\s*/, '') : job.error),
    };
  }

  return job;
}

export function isJobRetryable(job: Pick<QueueJobItem, 'status' | 'error' | 'currentStep'>): boolean {
  if (job.status === 'FAILED') return true;
  if (job.status === 'PENDING' && Boolean(job.error?.trim())) return true;
  if (
    job.status === 'PROCESSING' &&
    (Boolean(job.error?.trim()) || Boolean(job.currentStep?.startsWith('Failed:')))
  ) {
    return true;
  }
  return false;
}

function normalizeQueueJob(job: Partial<QueueJobItem> & { id: string; ticker: string; status: string }): QueueJobItem {
  return reconcileFailedJobState({
    id: job.id,
    ticker: job.ticker,
    companyName: job.companyName ?? null,
    overallConclusion: job.overallConclusion ?? null,
    currentPrice: job.currentPrice ?? null,
    currency: job.currency ?? null,
    estimatedCostUsd: job.estimatedCostUsd ?? null,
    totalTokens: job.totalTokens ?? null,
    status: job.status as QueueJobItem['status'],
    createdAt:
      typeof job.createdAt === 'string'
        ? job.createdAt
        : job.createdAt
          ? new Date(job.createdAt as unknown as string).toISOString()
          : new Date().toISOString(),
    completedAt: job.completedAt
      ? typeof job.completedAt === 'string'
        ? job.completedAt
        : new Date(job.completedAt as unknown as string).toISOString()
      : null,
    result: (job.result as AnalysisState | null) ?? null,
    progress: job.progress ?? 0,
    currentStep: job.currentStep ?? null,
    error: job.error ?? null,
    hasCheckpoint: Boolean(job.hasCheckpoint),
    logs: job.logs ?? null,
  });
}

function preserveDisplayFields(prev: QueueJobItem | undefined, job: QueueJobItem): QueueJobItem {
  if (!prev) return job;
  return {
    ...job,
    overallConclusion: job.overallConclusion?.trim() ? job.overallConclusion : prev.overallConclusion,
    companyName: job.companyName?.trim() ? job.companyName : prev.companyName,
    currentPrice: job.currentPrice?.trim() ? job.currentPrice : prev.currentPrice,
    currency: job.currency?.trim() ? job.currency : prev.currency,
  };
}

function applyServerJob(
  prev: QueueJobItem | undefined,
  incoming: QueueJobItem,
  retryInFlight: boolean
): QueueJobItem {
  const job = preserveDisplayFields(prev, reconcileFailedJobState(incoming));

  if (retryInFlight) {
    return {
      ...job,
      status: 'PENDING',
      error: null,
      completedAt: null,
      currentStep: job.hasCheckpoint ? 'Queued — resume from checkpoint' : 'Queued for retry',
    };
  }

  if (prev?.status === 'COMPLETED' && job.status !== 'COMPLETED') {
    return preserveDisplayFields(prev, { ...prev, ...job, status: 'COMPLETED' });
  }

  return job;
}

function mergeQueueJobs(
  incoming: QueueJobItem[],
  existing: QueueJobItem[],
  retryInFlightIds?: Set<string>
): QueueJobItem[] {
  const byId = new Map<string, QueueJobItem>();
  for (const job of existing) {
    byId.set(job.id, job);
  }
  for (const job of incoming) {
    const prev = byId.get(job.id);
    byId.set(
      job.id,
      prev
        ? applyServerJob(prev, job, retryInFlightIds?.has(job.id) ?? false)
        : reconcileFailedJobState(job)
    );
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function prependOptimisticJobs(
  prev: QueueDashboardState | null,
  newJobs: QueueJobItem[]
): QueueDashboardState {
  const existingIds = new Set((prev?.jobs ?? []).map(j => j.id));
  const added = newJobs.filter(j => !existingIds.has(j.id));
  const mergedJobs = mergeQueueJobs(newJobs, prev?.jobs ?? []);
  const stats = prev?.stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };

  return {
    jobs: mergedJobs,
    total: (prev?.total ?? 0) + added.length,
    stats: {
      ...stats,
      pending: stats.pending + added.filter(j => j.status === 'PENDING').length,
      processing: stats.processing + added.filter(j => j.status === 'PROCESSING').length,
    },
  };
}

interface UseBatchJobsOptions {
  /** When true, poll queue dashboard and restore session cache (survives tab switches). */
  queuePollingEnabled?: boolean;
}

export const useBatchJobs = (options?: UseBatchJobsOptions) => {
  const queuePollingEnabled = options?.queuePollingEnabled ?? false;
  const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);
  const [batchJobStatus, setBatchJobStatus] = useState<BatchJobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueDashboardState | null>(() => {
    const cached = readQueueCache();
    if (!cached) return null;
    return {
      ...cached,
      jobs: cached.jobs.map(job => reconcileFailedJobState(normalizeQueueJob(job))),
    };
  });
  const [queueFetchError, setQueueFetchError] = useState<string | null>(null);
  const queueStatusRef = useRef(queueStatus);
  queueStatusRef.current = queueStatus;
  const queueFetchGenerationRef = useRef(0);
  const queueFetchInFlightRef = useRef(false);
  const retryInFlightJobIdsRef = useRef<Set<string>>(new Set());

  const applyQueueStatus = useCallback((next: QueueDashboardState) => {
    setQueueStatus(next);
    writeQueueCache(next);
  }, []);

  const fetchQueueStatus = useCallback(async () => {
    if (!getAuthToken()) {
      return null;
    }
    if (queueFetchInFlightRef.current) {
      return queueStatusRef.current;
    }

    queueFetchInFlightRef.current = true;
    const fetchGeneration = ++queueFetchGenerationRef.current;

    try {
      const response = await apiFetch('/api/jobs?limit=50');
      if (fetchGeneration !== queueFetchGenerationRef.current) {
        return null;
      }
      if (response.status === 401) {
        setQueueFetchError(null);
        return null;
      }
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const data = await response.json();

      const transformedJobs: QueueJobItem[] = (data.jobs || []).map((job: QueueJobItem) =>
        normalizeQueueJob(job)
      );

      const prevJobs = queueStatusRef.current?.jobs ?? [];
      const prevById = new Map(prevJobs.map(job => [job.id, job]));
      const mergedJobs = transformedJobs.map(job => {
        const prev = prevById.get(job.id);
        return applyServerJob(prev, job, retryInFlightJobIdsRef.current.has(job.id));
      });

      const next: QueueDashboardState = {
        jobs: mergedJobs,
        total: data.total || mergedJobs.length,
        stats: data.stats || {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      };

      applyQueueStatus(next);
      setQueueFetchError(null);
      return next;
    } catch (error) {
      if (fetchGeneration === queueFetchGenerationRef.current) {
        console.error('Error fetching queue status:', error);
        setQueueFetchError(error instanceof Error ? error.message : 'Failed to load queue');
      }
      throw error;
    } finally {
      if (fetchGeneration === queueFetchGenerationRef.current) {
        queueFetchInFlightRef.current = false;
      }
    }
  }, [applyQueueStatus]);

  const mergeSubmittedJobs = useCallback(
    (newJobs: QueueJobItem[]) => {
      const normalized = newJobs.map(j => normalizeQueueJob(j));
      const next = prependOptimisticJobs(queueStatusRef.current, normalized);
      applyQueueStatus(next);
    },
    [applyQueueStatus]
  );

  const submitBatchJob = useCallback(
    async (tickers: string, language: Language): Promise<BatchSubmitResult> => {
      const response = await apiFetch('/api/jobs/batch', {
        method: 'POST',
        body: JSON.stringify({ tickers, language }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      const data = (await response.json()) as BatchSubmitResult;

      if (Array.isArray(data.jobs) && data.jobs.length > 0) {
        mergeSubmittedJobs(data.jobs);
      }

      setActiveBatchJobId(data.batchJobId);
      setIsPolling(true);

      void fetchQueueStatus();

      return data;
    },
    [fetchQueueStatus, mergeSubmittedJobs]
  );

  const fetchBatchJobStatus = useCallback(async (batchJobId: string) => {
    const response = await apiFetch(`/api/jobs/batch/${batchJobId}`);
    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }
    const data = await response.json();
    setBatchJobStatus(data);
    return data;
  }, []);

  useEffect(() => {
    if (!activeBatchJobId || !isPolling) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const status = await fetchBatchJobStatus(activeBatchJobId);
        if (status.overallStatus === 'COMPLETED' || status.overallStatus === 'FAILED') {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Error polling batch job status:', error);
      }
    }, 3000);

    void fetchBatchJobStatus(activeBatchJobId);

    return () => clearInterval(pollInterval);
  }, [activeBatchJobId, isPolling, fetchBatchJobStatus]);

  useEffect(() => {
    if (!queuePollingEnabled) {
      return;
    }

    void fetchQueueStatus();

    let cancelled = false;
    let timer: number | undefined;

    const scheduleNextPoll = () => {
      const stats = queueStatusRef.current?.stats;
      const hasActiveJobs = Boolean(stats && (stats.pending > 0 || stats.processing > 0));
      const delay = hasActiveJobs ? QUEUE_POLL_ACTIVE_MS : QUEUE_POLL_MS;
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.visibilityState !== 'hidden') {
          try {
            await fetchQueueStatus();
          } catch {
            // fetchQueueStatus already logs / sets queueFetchError
          }
        }
        scheduleNextPoll();
      }, delay);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [queuePollingEnabled, fetchQueueStatus]);

  const retryFailedJob = useCallback(
    async (jobId: string) => {
      retryInFlightJobIdsRef.current.add(jobId);
      setQueueStatus(prev => {
        if (!prev) return prev;
        const job = prev.jobs.find(j => j.id === jobId);
        if (!job || !isJobRetryable(job)) {
          return prev;
        }

        const jobs = prev.jobs.map(j =>
          j.id === jobId
            ? {
                ...j,
                status: 'PENDING' as const,
                error: null,
                completedAt: null,
                currentStep: j.hasCheckpoint ? 'Queued — resume from checkpoint' : 'Queued for retry',
              }
            : j
        );
        const stats = { ...prev.stats };
        stats.failed = Math.max(0, stats.failed - 1);
        stats.pending += 1;

        const next = { ...prev, jobs, stats };
        writeQueueCache(next);
        return next;
      });

      try {
        const response = await apiFetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
        if (!response.ok) {
          throw new Error(await parseErrorResponse(response));
        }
        setIsPolling(true);
        await fetchQueueStatus();
        return response.json();
      } catch (error) {
        await fetchQueueStatus();
        throw error;
      } finally {
        retryInFlightJobIdsRef.current.delete(jobId);
      }
    },
    [fetchQueueStatus]
  );

  const retryAllFailedJobs = useCallback(async () => {
    const ids = (queueStatusRef.current?.jobs.filter(isJobRetryable) ?? []).map(job => job.id);
    for (const id of ids) {
      await retryFailedJob(id);
    }
  }, [retryFailedJob]);

  const clearBatchJob = useCallback(() => {
    setActiveBatchJobId(null);
    setBatchJobStatus(null);
    setIsPolling(false);
  }, []);

  return {
    activeBatchJobId,
    batchJobStatus,
    isPolling,
    queueStatus,
    queueFetchError,
    submitBatchJob,
    fetchQueueStatus,
    fetchBatchJobStatus,
    clearBatchJob,
    retryFailedJob,
    retryAllFailedJobs,
  };
};
