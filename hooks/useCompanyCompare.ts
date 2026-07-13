import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';
import type { Language } from '../types.ts';
import type {
  CompareRunProgress,
  CompareRunResult,
  CompareRunStatusResponse,
  ComparisonItemInput,
  ComparisonSessionDetail,
  ComparisonSessionSummary,
  CreateCompareRequest,
} from '../types/compare.ts';
import type { EligibleCompareCompany } from '../utils/compareEligible.ts';
import { buildCompareBasketKey } from '../utils/compareEligible.ts';

const MAX_COMPARE_ITEMS = 10;
const POLL_INTERVAL_MS = 1500;
const PENDING_RUN_STORAGE_KEY = 'comparePendingRunId';

export type CompanyCompareController = ReturnType<typeof useCompanyCompare>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useCompanyCompare = () => {
  const [basket, setBasket] = useState<EligibleCompareCompany[]>([]);
  const [activeRun, setActiveRun] = useState<CompareRunResult | null>(null);
  const [sessions, setSessions] = useState<ComparisonSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ComparisonSessionDetail | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [compareProgress, setCompareProgress] = useState<CompareRunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const pollAbortRef = useRef(0);

  const fetchReport = useCallback(async (reportId: string) => {
    const response = await apiFetch(`/api/history/${reportId}`);
    if (!response.ok) {
      const message = await readApiError(response);
      throw new Error(message || 'Failed to load report');
    }
    const data = await response.json();
    if (!data.report) {
      throw new Error('Report payload missing');
    }
    return data.report;
  }, []);

  const applyStatusResponse = useCallback((status: CompareRunStatusResponse) => {
    setCompareProgress({
      runId: status.runId,
      sessionId: status.sessionId,
      status: status.status,
      progress: status.progress,
      currentStep: status.currentStep,
      error: status.error,
      items: status.items,
    });
    return status;
  }, []);

  const pollRunUntilComplete = useCallback(
    async (runId: string): Promise<CompareRunResult> => {
      const pollToken = ++pollAbortRef.current;

      while (pollToken === pollAbortRef.current) {
        const response = await apiFetch(`/api/compare/runs/${runId}`);
        const data = (await response.json()) as CompareRunStatusResponse & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load compare status');
        }

        applyStatusResponse(data);

        if (data.status === 'COMPLETED' && data.run) {
          sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
          return data.run;
        }
        if (data.status === 'FAILED') {
          sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
          throw new Error(data.error || 'Compare failed');
        }

        await sleep(POLL_INTERVAL_MS);
      }

      throw new Error('Compare polling cancelled');
    },
    [applyStatusResponse]
  );

  const startPollingRun = useCallback(
    async (runId: string, sessionId: string) => {
      sessionStorage.setItem(PENDING_RUN_STORAGE_KEY, runId);
      setCompareProgress({
        runId,
        sessionId,
        status: 'PROCESSING',
        progress: 0,
        currentStep: 'loading_reports',
      });
      setIsRunning(true);
      setError(null);
      try {
        const run = await pollRunUntilComplete(runId);
        setActiveRun(run);
        setCompareProgress(null);
        return run;
      } finally {
        setIsRunning(false);
      }
    },
    [pollRunUntilComplete]
  );

  useEffect(() => {
    const pendingRunId = sessionStorage.getItem(PENDING_RUN_STORAGE_KEY);
    if (!pendingRunId || isRunning || activeRun) return;

    void (async () => {
      try {
        const response = await apiFetch(`/api/compare/runs/${pendingRunId}`);
        const data = (await response.json()) as CompareRunStatusResponse & { error?: string };
        if (!response.ok) {
          sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
          return;
        }
        if (data.status === 'COMPLETED' && data.run) {
          sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
          setActiveRun(data.run);
          return;
        }
        if (data.status === 'FAILED') {
          sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
          setError(data.error || 'Compare failed');
          applyStatusResponse(data);
          return;
        }
        await startPollingRun(data.runId, data.sessionId);
      } catch {
        sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
      }
    })();
  }, [activeRun, applyStatusResponse, isRunning, startPollingRun]);

  const addToBasket = useCallback((company: EligibleCompareCompany) => {
    setBasket(prev => {
      const key = buildCompareBasketKey(company.reportId, company.companyId);
      if (prev.some(c => buildCompareBasketKey(c.reportId, c.companyId) === key)) return prev;
      if (prev.length >= MAX_COMPARE_ITEMS) return prev;
      if (prev.length > 0 && prev[0].reportLanguage !== company.reportLanguage) {
        setError(
          company.reportLanguage === 'cn'
            ? '不能混选中英文报告，请先清空对比篮。'
            : 'Cannot mix Chinese and English reports. Clear the basket first.'
        );
        return prev;
      }
      setError(null);
      return [...prev, company];
    });
  }, []);

  const removeFromBasket = useCallback((reportId: string, companyId: string) => {
    const key = buildCompareBasketKey(reportId, companyId);
    setBasket(prev => prev.filter(c => buildCompareBasketKey(c.reportId, c.companyId) !== key));
  }, []);

  const clearBasket = useCallback(() => {
    setBasket([]);
    setError(null);
  }, []);

  const cancelComparePolling = useCallback(() => {
    pollAbortRef.current += 1;
    sessionStorage.removeItem(PENDING_RUN_STORAGE_KEY);
    setIsRunning(false);
    setCompareProgress(null);
  }, []);

  const runCompare = useCallback(
    async (language: Language, label?: string) => {
      if (basket.length < 2) {
        throw new Error(language === 'cn' ? '至少选择 2 家公司' : 'Select at least 2 companies');
      }

      setActiveRun(null);
      setIsRunning(true);
      setError(null);
      setCompareProgress({
        runId: '',
        sessionId: '',
        status: 'PROCESSING',
        progress: 0,
        currentStep: 'loading_reports',
      });

      try {
        const body: CreateCompareRequest = {
          language,
          label,
          items: basket.map(
            (c): ComparisonItemInput => ({ reportId: c.reportId, companyId: c.companyId })
          ),
        };
        const response = await apiFetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Compare failed');

        const runId = String(data.runId || '');
        const sessionId = String(data.sessionId || '');
        if (!runId || !sessionId) {
          throw new Error('Compare start response missing runId');
        }

        const run = await startPollingRun(runId, sessionId);
        return run;
      } catch (err) {
        cancelComparePolling();
        throw err;
      }
    },
    [basket, cancelComparePolling, startPollingRun]
  );

  const followUpCompare = useCallback(
    async (sessionId: string, parentRunId: string, refreshReports: boolean) => {
      setIsRunning(true);
      setError(null);
      setCompareProgress({
        runId: '',
        sessionId,
        status: 'PROCESSING',
        progress: 0,
        currentStep: 'loading_reports',
      });

      try {
        const response = await apiFetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, parentRunId, refreshReports }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Follow-up compare failed');

        const runId = String(data.runId || '');
        if (!runId) throw new Error('Follow-up start response missing runId');

        const run = await startPollingRun(runId, sessionId);
        return run;
      } catch (err) {
        cancelComparePolling();
        throw err;
      }
    },
    [cancelComparePolling, startPollingRun]
  );

  const loadSessions = useCallback(async (options?: { force?: boolean }) => {
    if (sessionsLoaded && !options?.force) {
      return sessions;
    }
    const response = await apiFetch('/api/compare/sessions');
    if (!response.ok) throw new Error('Failed to load compare history');
    const data = await response.json();
    const nextSessions = (data.sessions || []) as ComparisonSessionSummary[];
    setSessions(nextSessions);
    setSessionsLoaded(true);
    return nextSessions;
  }, [sessions, sessionsLoaded]);

  const loadSession = useCallback(async (sessionId: string) => {
    const response = await apiFetch(`/api/compare/sessions/${sessionId}`);
    if (!response.ok) throw new Error('Failed to load session');
    const data = await response.json();
    setActiveSession(data.session);
    return data.session as ComparisonSessionDetail;
  }, []);

  const loadRun = useCallback(
    async (runId: string) => {
      const response = await apiFetch(`/api/compare/runs/${runId}`);
      if (!response.ok) throw new Error('Failed to load run');
      const data = (await response.json()) as CompareRunStatusResponse;

      if (data.status === 'PROCESSING') {
        const run = await startPollingRun(data.runId, data.sessionId);
        return run;
      }
      if (data.status === 'FAILED') {
        throw new Error(data.error || 'Comparison failed');
      }
      if (!data.run) throw new Error('Comparison result unavailable');

      setActiveRun(data.run);
      return data.run;
    },
    [startPollingRun]
  );

  return {
    basket,
    activeRun,
    sessions,
    activeSession,
    isRunning,
    compareProgress,
    error,
    maxCompareItems: MAX_COMPARE_ITEMS,
    fetchReport,
    addToBasket,
    removeFromBasket,
    clearBasket,
    runCompare,
    followUpCompare,
    loadSessions,
    loadSession,
    loadRun,
    setActiveRun,
    setError,
    cancelComparePolling,
    sessionsLoaded,
  };
};
