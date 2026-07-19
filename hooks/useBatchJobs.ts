import { useState, useCallback, useEffect, useRef } from 'react';
import { Language, AnalysisState } from '../types.ts';
import { apiFetch, getAuthToken, readApiError } from '../utils/authenticatedFetch.ts';

const QUEUE_CACHE_KEY = 'intelligent-stock-agent:batch-queue-v1';
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

function normalizeQueueJob(job: Partial<QueueJobItem> & { id: string; ticker: string; status: string }): QueueJobItem {
  return {
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
  };
}

function mergeQueueJobs(incoming: QueueJobItem[], existing: QueueJobItem[]): QueueJobItem[] {
  const byId = new Map<string, QueueJobItem>();
  for (const job of existing) {
    byId.set(job.id, job);
  }
  for (const job of incoming) {
    const prev = byId.get(job.id);
    byId.set(job.id, prev ? mergeQueueJobUpdate(prev, job) : job);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Keep stable list fields when a stale poll returns nulls or regresses status. */
function mergeQueueJobUpdate(prev: QueueJobItem, incoming: QueueJobItem): QueueJobItem {
  const merged: QueueJobItem = { ...prev, ...incoming };

  if (!incoming.overallConclusion?.trim() && prev.overallConclusion?.trim()) {
    merged.overallConclusion = prev.overallConclusion;
  }
  if (!incoming.companyName?.trim() && prev.companyName?.trim()) {
    merged.companyName = prev.companyName;
  }
  if (!incoming.currentPrice?.trim() && prev.currentPrice?.trim()) {
    merged.currentPrice = prev.currentPrice;
  }
  if (!incoming.currency?.trim() && prev.currency?.trim()) {
    merged.currency = prev.currency;
  }

  const statusRank: Record<QueueJobItem['status'], number> = {
    PENDING: 0,
    PROCESSING: 1,
    FAILED: 2,
    COMPLETED: 3,
  };
  if (statusRank[prev.status] > statusRank[incoming.status]) {
    merged.status = prev.status;
    merged.progress = Math.max(prev.progress ?? 0, incoming.progress ?? 0);
    merged.completedAt = prev.completedAt ?? incoming.completedAt;
  }

  return merged;
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
  const [queueStatus, setQueueStatus] = useState<QueueDashboardState | null>(() => readQueueCache());
  const [queueFetchError, setQueueFetchError] = useState<string | null>(null);
  const queueStatusRef = useRef(queueStatus);
  queueStatusRef.current = queueStatus;
  const queueFetchGenerationRef = useRef(0);
  const queueFetchInFlightRef = useRef(false);

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
        return prev ? mergeQueueJobUpdate(prev, job) : job;
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
      const response = await apiFetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }
      setIsPolling(true);
      await fetchQueueStatus();
      return response.json();
    },
    [fetchQueueStatus]
  );

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
  };
};
