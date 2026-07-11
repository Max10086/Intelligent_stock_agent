
import { useState, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { ai } from '../services/gemini.ts';
import { getFinancialData, searchTicker } from '../services/finance.ts';
import { Type } from '@google/genai';
import { AnalysisState, CompanyAnalysis, CompanyProfile, Language, QnAResult, GroundingSource, InvestmentConclusion, FinalConclusion, LlmTelemetryEntry, RuntimeModelConfig, SearchProvider, FollowUpBaseline, FollowUpMeta } from '../types.ts';
import { getUIText } from '../constants.ts';
import { cleanupBrokenNumericFormatting, mergeBrokenEvidenceFragments } from '../utils/textNormalize.ts';
import { buildFinalConclusionPrompt, buildFinalConclusionStrictRetrySuffix } from '../utils/finalConclusionPrompt.ts';
import { normalizeInvestmentConclusion } from '../utils/investmentConclusionNormalize.ts';
import { parseModelJsonResponse } from '../utils/modelJson.ts';
import {
  hasUsableInvestmentConclusion,
  THESIS_SECTION_KEYS,
} from '../utils/synthesizeConclusionPrompt.ts';
import { synthesizeInvestmentConclusionBySections } from '../utils/synthesizeConclusionOrchestrator.ts';
import type { ThesisSectionKey } from '../utils/synthesizeConclusionPrompt.ts';
import { QNA_CONCURRENCY, runParallelIndexedTasks } from '../utils/parallelTasks.ts';
import { indexAnsweredQuestions, orderQnaByQuestions, countAnsweredQuestions } from '../utils/qnaHelpers.ts';
import {
  createQnaProgressRunId,
  diagnoseQuestionCount,
  logQnaProgress,
  QnaProgressReporter,
  registerQnaProgressRun,
  snapshotQnaMaps,
  unregisterQnaProgressRun,
} from '../utils/qnaProgressDebug.ts';
import { isUnusableSearchAnswer } from '../utils/qnaAnswerQuality.ts';
import {
  alignConceptDiscoveryByMarket,
  buildFindCompaniesByConceptPrompt,
  buildFindCompetitorsPrompt,
  parseConceptDiscoveryResponse,
  prioritizeCompetitorsByMarket,
  runCompetitorDiscovery,
} from '../utils/companyDiscovery.ts';
import {
  findIncompleteCompanies,
  hasUsableFinalConclusion,
  isCandidateAwaitingUser,
  isCompanyAnalysisComplete,
  normalizeReportOnLoad,
} from '../utils/analysisComplete.ts';
import { slimHistoryItem } from '../utils/historyListSummary.ts';
import { createStepLogEntry, type AnalysisStepKey } from '../utils/analysisStepLog.ts';
import { buildGenerateQuestionsPrompt } from '../utils/questionGenerationPrompt.ts';
import { generateQuestionsInBatches } from '../utils/questionGenerationBatches.ts';
import { buildRecencyGuidance } from '../utils/recencyGuidance.ts';
import {
  buildWrongCompanyRetryAppendix,
  buildQuickTakeIdentityRule,
  detectWrongCompanyMix,
} from '../utils/companyIdentity.ts';
import { buildAnswerQuestionPrompt, buildVerifiedMarketContext } from '../utils/marketSnapshot.ts';
import { pickLanguageValidQuestions } from '../utils/questionLanguage.ts';
import {
  buildExpectationGapQuestionsPrompt,
  EXPECTATION_GAP_QUESTION_COUNT,
  getCoreQuestionCount,
} from '../utils/expectationGapPrompt.ts';
import { mergeCoreAndExpectationGapQuestions } from '../utils/mergeQuestionSets.ts';
import {
  DEFAULT_FOLLOW_UP_QUESTION_COUNT,
  buildFollowUpQueryLabel,
  extractFollowUpBaseline,
  getFollowUpEligibleCompanies,
} from '../utils/followUpHelpers.ts';
import {
  buildFollowUpAnswerPrompt,
  buildFollowUpFinalConclusionPrompt,
  buildFollowUpPriorContextBlock,
  buildFollowUpQuestionsPrompt,
  buildFollowUpRecencyGuidance,
} from '../utils/followUpPrompts.ts';
import {
  DEFAULT_RUNTIME_MODEL_CONFIG,
  loadStoredRuntimeModelConfig,
  migrateRuntimeModelConfig,
  normalizeRuntimeModelConfig,
  pushRuntimeModelConfigToBackend,
  resolveAuthoritativeRuntimeModelConfig,
  saveStoredRuntimeModelConfig,
  syncAuthoritativeRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';
import { buildMarketCapPromptRule, formatMarketCapForPrompt } from '../utils/priceFormat.ts';
import { resolveMarketCurrency } from '../utils/marketCurrency.ts';
import { sanitizeQuickTakeMarketCap } from '../utils/marketCapTextSanitize.ts';
import { apiFetch, getAuthToken } from '../utils/authenticatedFetch.ts';
import { checkUsageQuota, recordCompanyUsage } from '../utils/usageClient.ts';
import { notifyUsageUpdated } from '../utils/usageEvents.ts';

const ACTIVE_ANALYSIS_KEY = 'intelligentStockAgentActiveState';
const HISTORY_KEY = 'intelligentStockAgentHistory';
const PENDING_SAVE_KEY = 'intelligentStockAgentPendingSaves';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';
const HISTORY_FETCH_TIMEOUT_MS = 45000;
const REPORT_FETCH_TIMEOUT_MS = 120000;
const HISTORY_PAGE_SIZE = 20;
const HISTORY_MAX_ITEMS = 100;
const HISTORY_FIRST_PAGE_TIMEOUT_MS = 45000;
const HISTORY_CACHE_VERSION = 2;

const formatUsageLimitMessage = (error: unknown, lang: Language): string => {
  const ui = getUIText(lang);
  if (error && typeof error === 'object' && 'usage' in error) {
    const usage = (error as { usage?: { requiresUpgrade?: boolean } }).usage;
    if (usage?.requiresUpgrade) return ui.usageLimitReached;
  }
  if (error instanceof Error && error.message) return error.message;
  return ui.usageLimitReached;
};

export interface UseStockAgentOptions {
  /** Skip server history fetch until auth is ready (avoids 401 + stale cache). */
  historyFetchEnabled?: boolean;
  /** Refetch when the signed-in user changes; also scopes localStorage cache. */
  userId?: string | null;
}

const normalizeSearchProvider = (value: unknown): SearchProvider =>
  value === 'vertex' ? 'vertex' : 'doubao';

const getFirstString = (obj: any, keys: string[]): string => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeEvidenceItem = (value: any): string => {
  if (typeof value === 'string') return cleanupBrokenNumericFormatting(value);
  if (typeof value === 'number' || typeof value === 'boolean') return cleanupBrokenNumericFormatting(String(value));
  if (value && typeof value === 'object') {
    const fromKnownKeys = getFirstString(value, [
      'evidence',
      'text',
      'detail',
      'fact',
      'data',
      'value',
      'source',
      'content',
    ]);
    if (fromKnownKeys) return cleanupBrokenNumericFormatting(fromKnownKeys);
    try {
      return cleanupBrokenNumericFormatting(JSON.stringify(value));
    } catch {
      return '';
    }
  }
  return '';
};

const normalizeEvidenceList = (value: any): string[] => {
  if (Array.isArray(value)) {
    const items = value
      .map(normalizeEvidenceItem)
      .map(v => v.trim())
      .filter(Boolean);
    return mergeBrokenEvidenceFragments(items);
  }
  if (typeof value === 'string' && value.trim()) {
    // Preserve evidence as complete prose. Splitting on single newlines can break dates like 2026-06-17.
    return [cleanupBrokenNumericFormatting(value)].filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const single = normalizeEvidenceItem(value);
    return single ? [single] : [];
  }
  return [];
};

const normalizeFinalBulletPoint = (point: any) => {
  if (typeof point === 'string') {
    return { argument: point.trim(), evidence: [] as string[] };
  }
  return {
    argument: cleanupBrokenNumericFormatting(getFirstString(point, ['argument', 'claim', 'point', 'thesis', 'summary'])),
    evidence: normalizeEvidenceList(
      point?.evidence ??
        point?.supporting_evidence ??
        point?.supportingEvidence ??
        point?.data_points ??
        point?.dataPoints ??
        point?.facts ??
        point?.proof
    ),
  };
};

const normalizeFinalConclusion = (raw: any): FinalConclusion => {
  const bulletRaw =
    raw?.bullet_points ??
    raw?.bulletPoints ??
    raw?.key_points ??
    raw?.keyPoints ??
    raw?.points ??
    raw?.arguments ??
    [];
  const bulletPoints = Array.isArray(bulletRaw)
    ? bulletRaw.map(normalizeFinalBulletPoint)
    : normalizeEvidenceList(bulletRaw).map(text => ({ argument: text, evidence: [] as string[] }));

  return {
    overall_conclusion: cleanupBrokenNumericFormatting(getFirstString(raw, [
      'overall_conclusion',
      'overallConclusion',
      'conclusion',
      'recommendation',
      'verdict',
    ])),
    bullet_points: bulletPoints.filter(point => point.argument || point.evidence.length > 0),
    vs_prior: raw?.vs_prior
      ? {
          prior_overall_conclusion: cleanupBrokenNumericFormatting(
            getFirstString(raw.vs_prior, ['prior_overall_conclusion', 'priorOverallConclusion', 'prior_conclusion'])
          ),
          rating_change: (['upgrade', 'maintain', 'downgrade', 'unknown'] as const).includes(
            raw.vs_prior?.rating_change
          )
            ? raw.vs_prior.rating_change
            : undefined,
          change_summary: cleanupBrokenNumericFormatting(
            getFirstString(raw.vs_prior, ['change_summary', 'changeSummary', 'summary'])
          ),
        }
      : undefined,
  };
};

const createInitialState = (): AnalysisState => ({
  id: ``,
  timestamp: ``,
  status: 'idle',
  language: 'en',
  query: '',
  focusCompany: null,
  candidateCompanies: [],
  error: null,
  currentStage: '',
  currentProgress: 0,
  stepLogs: [],
});

interface PendingSavePayload {
  result: AnalysisState;
  query: string;
  language: Language;
  queuedAt: string;
}

interface FollowUpRunContext {
  baseline: FollowUpBaseline;
  priorConclusion: InvestmentConclusion | null;
  parentTimestamp: string;
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const loadCachedHistory = (userId: string | null): AnalysisState[] => {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | { version?: number; userId?: string; items?: AnalysisState[] }
      | AnalysisState[];
    if (Array.isArray(parsed)) {
      return [];
    }
    if (
      parsed?.version !== HISTORY_CACHE_VERSION ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.items)
    ) {
      return [];
    }
    return parsed.items;
  } catch {
    return [];
  }
};

const saveCachedHistory = (userId: string, items: AnalysisState[]) => {
  try {
    if (!items.length) {
      localStorage.removeItem(HISTORY_KEY);
      return;
    }
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        version: HISTORY_CACHE_VERSION,
        userId,
        items,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // best-effort cache
  }
};

const clearCachedHistory = () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
};

export const useStockAgent = (options: UseStockAgentOptions = {}) => {
  const historyFetchEnabled = options.historyFetchEnabled ?? true;
  const userId = options.userId ?? null;
  const [analysisState, setAnalysisState] = useState<AnalysisState>(() => {
    const initialState = createInitialState();
    try {
      const savedStateJSON = localStorage.getItem(ACTIVE_ANALYSIS_KEY);
      if (savedStateJSON) {
        const savedState: Partial<AnalysisState> = JSON.parse(savedStateJSON);
        const mergedState: AnalysisState = { ...initialState, ...savedState };

        if (mergedState.status === 'finding_companies' || mergedState.status === 'analyzing') {
          mergedState.status = 'error';
          mergedState.error = getUIText(mergedState.language).interruptedMessage; 
          mergedState.currentStage = getUIText(mergedState.language).interrupted;
        }
        return mergedState;
      }
    } catch (error) {
      console.error('Could not load active state from local storage', error);
      localStorage.removeItem(ACTIVE_ANALYSIS_KEY);
    }
    return initialState;
  });

  const [history, setHistory] = useState<AnalysisState[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [historyLoadedCount, setHistoryLoadedCount] = useState(0);
  const [historyTotalCount, setHistoryTotalCount] = useState<number | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [runtimeModelConfig, setRuntimeModelConfig] = useState<RuntimeModelConfig>(() =>
    typeof window !== 'undefined'
      ? resolveAuthoritativeRuntimeModelConfig(DEFAULT_RUNTIME_MODEL_CONFIG)
      : DEFAULT_RUNTIME_MODEL_CONFIG
  );
  const analysisStateRef = useRef<AnalysisState>(analysisState);
  const telemetryRef = useRef<LlmTelemetryEntry[]>([]);
  const historyFetchRef = useRef<Promise<AnalysisState[]> | null>(null);
  const historyCacheSavedRef = useRef(false);
  const historyFullyLoadedRef = useRef(false);
  const historyRef = useRef<AnalysisState[]>([]);
  const userIdRef = useRef<string | null>(userId);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Only persist history after a successful full server sync (never mid-pagination).
  useEffect(() => {
    if (historyCacheSavedRef.current && history.length > 0 && userId) {
      saveCachedHistory(userId, history);
    }
  }, [history, userId]);

  const loadPendingSaves = useCallback((): PendingSavePayload[] => {
    try {
      const raw = localStorage.getItem(PENDING_SAVE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const savePendingSaves = useCallback((items: PendingSavePayload[]) => {
    try {
      if (!items.length) {
        localStorage.removeItem(PENDING_SAVE_KEY);
        return;
      }
      localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(items));
    } catch {
      // Best-effort local cache only.
    }
  }, []);

  const enqueuePendingSave = useCallback((payload: PendingSavePayload) => {
    const pending = loadPendingSaves();
    const deduped = pending.filter(item => item?.result?.id !== payload.result.id);
    deduped.push(payload);
    savePendingSaves(deduped);
  }, [loadPendingSaves, savePendingSaves]);

  const fetchHistoryFromServer = useCallback(
    async (onPartial?: (items: AnalysisState[], meta: { total: number | null; hasMore: boolean }) => void): Promise<AnalysisState[]> => {
      if (historyFetchRef.current) {
        return historyFetchRef.current;
      }

      const sortHistory = (items: AnalysisState[]) =>
        [...items].sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeB - timeA;
        });

      const mergeHistory = (existing: AnalysisState[], incoming: AnalysisState[]) => {
        const byId = new Map<string, AnalysisState>();
        for (const item of existing) {
          if (item.id) byId.set(item.id, item);
        }
        for (const item of incoming) {
          if (item.id) byId.set(item.id, item);
        }
        return sortHistory(Array.from(byId.values()));
      };

      const fetchPage = async (
        limit: number,
        offset: number,
        timeoutMs: number,
        includeTotal: boolean,
        signal?: AbortSignal
      ) => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
          const onAbort = () => controller.abort();
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            const params = new URLSearchParams({
              limit: String(limit),
              offset: String(offset),
              includeTotal: includeTotal ? 'true' : 'false',
            });
            const response = await apiFetch(`/api/history?${params.toString()}`, {
              signal: controller.signal,
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(
                (errorData as { error?: string }).error ||
                  `Failed to fetch server history (${response.status})`
              );
            }
            const data = await response.json();
            const serverHistory: AnalysisState[] = data.history || [];
            const hasMore = Boolean(data.hasMore);
            const total =
              typeof data.total === 'number'
                ? data.total
                : serverHistory.length + (hasMore ? 1 : 0);
            return { history: sortHistory(serverHistory), total, hasMore };
          } catch (error) {
            lastError = error;
            const aborted = error instanceof DOMException && error.name === 'AbortError';
            if (!aborted || attempt >= 2) {
              throw error;
            }
            await delay(400 * attempt);
          } finally {
            window.clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onAbort);
          }
        }
        throw lastError;
      };

      const fetchPromise = (async () => {
        const pageSize = HISTORY_PAGE_SIZE;
        let offset = 0;
        let merged: AnalysisState[] = [];
        let hasMore = true;
        let total: number | null = null;
        let firstPage = true;

        while (hasMore && offset < HISTORY_MAX_ITEMS) {
          try {
            const page = await fetchPage(
              pageSize,
              offset,
              firstPage ? HISTORY_FIRST_PAGE_TIMEOUT_MS : HISTORY_FETCH_TIMEOUT_MS,
              false
            );
            merged = mergeHistory(merged, page.history);
            if (firstPage && typeof page.total === 'number') {
              total = page.total;
            }
            hasMore = page.hasMore;
            offset += page.history.length;
            firstPage = false;

            onPartial?.(merged, { total, hasMore });
            if (!page.history.length) break;
          } catch (error) {
            if (merged.length > 0) {
              console.warn('History page fetch failed, keeping loaded pages:', error);
              return merged;
            }
            throw error;
          }
        }

        return merged;
      })();

      historyFetchRef.current = fetchPromise;
      try {
        return await fetchPromise;
      } finally {
        if (historyFetchRef.current === fetchPromise) {
          historyFetchRef.current = null;
        }
      }
    },
    []
  );

  const fetchReportById = useCallback(async (id: string): Promise<AnalysisState> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REPORT_FETCH_TIMEOUT_MS);

    const loadFromHistoryEndpoint = async () => {
      const response = await apiFetch(`/api/history/${id}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || `Failed to load report (${response.status})`
        );
      }
      const data = await response.json();
      if (!data.report) {
        throw new Error('Report payload missing');
      }
      return data.report as AnalysisState;
    };

    const loadFromJobEndpoint = async () => {
      const response = await apiFetch(`/api/jobs/${id}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || `Failed to load job report (${response.status})`
        );
      }
      const data = await response.json();
      if (!data.result) {
        throw new Error('Job report payload missing');
      }
      return { ...(data.result as AnalysisState), id: data.id ?? id };
    };

    try {
      try {
        return await loadFromHistoryEndpoint();
      } catch (historyError) {
        const message = historyError instanceof Error ? historyError.message : String(historyError);
        if (/not found|404/i.test(message)) {
          return await loadFromJobEndpoint();
        }
        throw historyError;
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  // Fetch history from server once auth is ready (100% server-based).
  useEffect(() => {
    if (!historyFetchEnabled || !userId) {
      historyCacheSavedRef.current = false;
      historyFullyLoadedRef.current = false;
      setHistory([]);
      setHistoryLoadedCount(0);
      setHistoryTotalCount(null);
      setHistoryHasMore(false);
      setHistoryError(null);
      setIsLoadingHistory(false);
      setIsLoadingMoreHistory(false);
      if (!userId) {
        clearCachedHistory();
      }
      return;
    }

    let cancelled = false;

    const fetchServerHistory = async () => {
      historyCacheSavedRef.current = false;
      historyFullyLoadedRef.current = false;
      setIsLoadingMoreHistory(false);
      setHistoryError(null);

      const cached = loadCachedHistory(userId);
      if (cached.length > 0) {
        setHistory(cached);
        setHistoryLoadedCount(cached.length);
        setHistoryTotalCount(cached.length);
        setHistoryHasMore(false);
        setIsLoadingHistory(false);
        historyCacheSavedRef.current = true;
      } else {
        setIsLoadingHistory(true);
      }

      try {
        const sortedHistory = await fetchHistoryFromServer((partial, meta) => {
          if (cancelled) return;
          setHistory(partial);
          setHistoryLoadedCount(partial.length);
          setHistoryTotalCount(partial.length);
          setHistoryHasMore(meta.hasMore);
          if (partial.length > 0) {
            setIsLoadingHistory(false);
            setIsLoadingMoreHistory(meta.hasMore);
          }
        });
        if (cancelled) return;
        setHistory(sortedHistory);
        setHistoryLoadedCount(sortedHistory.length);
        setHistoryTotalCount(sortedHistory.length);
        setHistoryHasMore(false);
        historyCacheSavedRef.current = true;
        historyFullyLoadedRef.current = true;
      } catch (error) {
        if (cancelled) return;
        console.error('Could not fetch server history:', error);
        const cachedAfterError = loadCachedHistory(userId);
        let hadInMemoryHistory = false;
        setHistory(prev => {
          hadInMemoryHistory = prev.length > 0;
          if (hadInMemoryHistory) return prev;
          if (cachedAfterError.length > 0) return cachedAfterError;
          return [];
        });
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'History request timed out. The backend may be stuck — try restarting npm run dev.'
            : error instanceof Error
              ? error.message
              : 'Failed to fetch history';
        const hasFallbackData = cachedAfterError.length > 0 || hadInMemoryHistory;
        setHistoryError(hasFallbackData ? null : message);
        setHistoryHasMore(false);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
          setIsLoadingMoreHistory(false);
        }
      }
    };

    void fetchServerHistory();
    return () => {
      cancelled = true;
    };
  }, [fetchHistoryFromServer, historyFetchEnabled, userId]);

  const applyRuntimeModelConfig = useCallback((config: RuntimeModelConfig) => {
    const nextConfig = normalizeRuntimeModelConfig(config, DEFAULT_RUNTIME_MODEL_CONFIG);
    const { config: migratedConfig } = migrateRuntimeModelConfig(nextConfig);
    setRuntimeModelConfig(migratedConfig);
    saveStoredRuntimeModelConfig(migratedConfig);
    return migratedConfig;
  }, []);

  const reloadRuntimeModelConfig = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/vertex-ai/model-config`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.analysis?.provider && data?.analysis?.model && data?.search?.model) {
        return normalizeRuntimeModelConfig(data, DEFAULT_RUNTIME_MODEL_CONFIG);
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const syncRuntimeModelConfigFromUserSettings = useCallback(async (): Promise<RuntimeModelConfig> => {
    const synced = await syncAuthoritativeRuntimeModelConfig(API_BASE_URL, DEFAULT_RUNTIME_MODEL_CONFIG);
    setRuntimeModelConfig(synced);
    return synced;
  }, []);

  useEffect(() => {
    if (!getAuthToken()) return;
    syncRuntimeModelConfigFromUserSettings();
  }, [syncRuntimeModelConfigFromUserSettings]);

  useEffect(() => {
    analysisStateRef.current = analysisState;
  }, [analysisState]);

  useEffect(() => {
    try {
      if (analysisState.status !== 'idle') {
        localStorage.setItem(ACTIVE_ANALYSIS_KEY, JSON.stringify(analysisState));
      } else {
        localStorage.removeItem(ACTIVE_ANALYSIS_KEY);
      }
    } catch (error) {
      console.error('Could not save active state to local storage', error);
    }
  }, [analysisState]);

  // Refresh history from server (called after save/delete operations)
  const refreshHistory = useCallback(async (options?: { silent?: boolean }) => {
    if (!userIdRef.current) return;
    const silent = options?.silent ?? false;
    const hasExistingHistory = historyRef.current.length > 0;
    historyCacheSavedRef.current = false;
    historyFullyLoadedRef.current = false;
    setHistoryError(null);
    if (silent || hasExistingHistory) {
      setIsLoadingMoreHistory(true);
    } else {
      setIsLoadingHistory(true);
    }
    try {
      const sortedHistory = await fetchHistoryFromServer((partial, meta) => {
        setHistory(partial);
        setHistoryLoadedCount(partial.length);
        setHistoryTotalCount(partial.length);
        setHistoryHasMore(meta.hasMore);
        if (partial.length > 0) {
          setIsLoadingHistory(false);
          setIsLoadingMoreHistory(meta.hasMore);
        }
      });
      setHistory(sortedHistory);
      setHistoryLoadedCount(sortedHistory.length);
      setHistoryTotalCount(sortedHistory.length);
      setHistoryHasMore(false);
      historyCacheSavedRef.current = true;
      historyFullyLoadedRef.current = true;
    } catch (error) {
      console.error('Could not refresh history:', error);
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'History request timed out. The backend may be stuck — try restarting npm run dev.'
          : error instanceof Error
            ? error.message
            : 'Failed to fetch history';
      setHistoryError(hasExistingHistory ? null : message);
      setHistoryHasMore(false);
    } finally {
      setIsLoadingHistory(false);
      setIsLoadingMoreHistory(false);
    }
  }, [fetchHistoryFromServer]);

  const retryPendingSaves = useCallback(async () => {
    const pending = loadPendingSaves();
    if (!pending.length) return { success: 0, failed: 0 };

    let success = 0;
    let failed = 0;
    const remaining: PendingSavePayload[] = [];

    for (const item of pending) {
      try {
        const response = await apiFetch(`/api/history`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            result: item.result,
            query: item.query,
            language: item.language,
          }),
        });

        if (!response.ok) {
          failed += 1;
          remaining.push(item);
          continue;
        }

        success += 1;
      } catch {
        failed += 1;
        remaining.push(item);
      }
    }

    savePendingSaves(remaining);
    if (success > 0) {
      await refreshHistory();
    }
    return { success, failed };
  }, [loadPendingSaves, savePendingSaves, refreshHistory]);

  useEffect(() => {
    void retryPendingSaves();
    const interval = window.setInterval(() => {
      void retryPendingSaves();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [retryPendingSaves]);

  const applyAnalysisStateUpdate = (updater: (prev: AnalysisState) => AnalysisState) => {
    const next = updater(analysisStateRef.current);
    analysisStateRef.current = next;
    setAnalysisState(next);
  };

  /** Commit React state synchronously so persist reads the latest company payloads. */
  const commitAnalysisState = useCallback((updater: (prev: AnalysisState) => AnalysisState): AnalysisState => {
    let committed!: AnalysisState;
    flushSync(() => {
      committed = updater(analysisStateRef.current);
      analysisStateRef.current = committed;
      setAnalysisState(committed);
    });
    return committed;
  }, []);

  /** Build persist payload from ref — ref is ahead of React state during async analysis. */
  const snapshotForPersist = useCallback((overrides: Partial<AnalysisState> = {}): AnalysisState => {
    const base = analysisStateRef.current;
    return {
      ...base,
      focusCompany: base.focusCompany,
      candidateCompanies: base.candidateCompanies,
      stepLogs: base.stepLogs ?? [],
      llmTelemetry: overrides.llmTelemetry ?? base.llmTelemetry ?? telemetryRef.current,
      ...overrides,
    };
  }, []);

  const updateState = (update: Partial<AnalysisState>) => {
    applyAnalysisStateUpdate(prev => ({ ...prev, ...update }));
  };

  const updateCompanyState = (companyId: string, update: Partial<CompanyAnalysis>) => {
    applyAnalysisStateUpdate(prev => {
      let matched = false;
      const newFocus =
        prev.focusCompany?.id === companyId
          ? ((matched = true), { ...prev.focusCompany, ...update })
          : prev.focusCompany;
      const newCandidates = prev.candidateCompanies.map(candidate => {
        if (candidate.id !== companyId) return candidate;
        matched = true;
        return { ...candidate, ...update };
      });
      if (!matched) {
        console.warn(`[useStockAgent] updateCompanyState: no company matched id=${companyId}`);
      }
      return { ...prev, focusCompany: newFocus as CompanyAnalysis, candidateCompanies: newCandidates };
    });
  };

  const appendStepLog = (
    companyId: string,
    companyName: string,
    step: AnalysisStepKey,
    startedAt: number,
    lang: Language
  ) => {
    applyAnalysisStateUpdate(prev => ({
      ...prev,
      stepLogs: [
        ...(prev.stepLogs || []),
        createStepLogEntry({ companyId, companyName, step, lang, startedAt }),
      ],
    }));
  };

  const runWithStepLog = async <T>(
    companyId: string,
    companyName: string,
    step: AnalysisStepKey,
    lang: Language,
    fn: () => Promise<T>
  ): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      appendStepLog(companyId, companyName, step, startedAt, lang);
    }
  };

  const isValidCompanyProfile = (item: any): item is Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> => {
    return Boolean(
      item &&
        typeof item.name === 'string' &&
        item.name.trim() &&
        typeof item.ticker === 'string' &&
        item.ticker.trim() &&
        typeof item.exchange === 'string' &&
        item.exchange.trim()
    );
  };

  const searchTickerViaServer = useCallback(async (query: string): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> | null> => {
    try {
      const response = await apiFetch(`/api/search-ticker?query=${encodeURIComponent(query)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return isValidCompanyProfile(data?.match) ? data.match : null;
    } catch {
      return null;
    }
  }, []);

  const appendTelemetry = (step: string, startedAt: number, response: any) => {
    telemetryRef.current.push({
      step,
      provider: (response?.provider ||
        (step === 'answer_question' ? runtimeModelConfig.search.provider : runtimeModelConfig.analysis.provider)) as LlmTelemetryEntry['provider'],
      model: response?.model || runtimeModelConfig.analysis.model,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      usage: response?.usage,
    });
  };

  const findCompetitors = async (focusCompany: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>, lang: Language): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const companySchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Company's official name" },
        ticker: { type: Type.STRING, description: "Company's primary stock ticker" },
        exchange: { type: Type.STRING, description: 'NASDAQ, NYSE, AMEX, HKEX, SSE, or SZSE' },
      },
      required: ['name', 'ticker', 'exchange'],
    };
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        competitors: { type: Type.ARRAY, items: companySchema },
      },
      required: ['competitors'],
    };

    return runCompetitorDiscovery(focusCompany, async ({ strictRetry, allowCrossMarket }) => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'company_discovery',
        contents: {
          role: 'user',
          parts: [{
            text: buildFindCompetitorsPrompt(focusCompany, outputLanguage, { strictRetry, allowCrossMarket }),
          }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      appendTelemetry('company_discovery', startedAt, response);
      return response.text || '';
    });
  };

  const findCompaniesByConcept = async (query: string, lang: Language): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
      const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
      const companySchema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Company's official name" },
          ticker: { type: Type.STRING, description: "Company's primary stock ticker" },
          exchange: { type: Type.STRING, description: 'NASDAQ, NYSE, AMEX, HKEX, SSE, or SZSE' },
        },
        required: ['name', 'ticker', 'exchange'],
      };
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          focusCompany: companySchema,
          candidateCompanies: { type: Type.ARRAY, items: companySchema },
        },
        required: ['focusCompany', 'candidateCompanies'],
      };

      const callDiscovery = async (strict: boolean) => {
        const startedAt = Date.now();
        const response = await ai.models.generateContent({
          provider: runtimeModelConfig.analysis.provider,
          model: runtimeModelConfig.analysis.model,
          step: 'company_discovery',
          contents: {
            role: 'user',
            parts: [{ text: buildFindCompaniesByConceptPrompt(query, outputLanguage, strict) }],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
        appendTelemetry('company_discovery', startedAt, response);
        return response.text || '';
      };

      let companies = parseConceptDiscoveryResponse(await callDiscovery(false));
      if (companies.length === 0) {
        companies = parseConceptDiscoveryResponse(await callDiscovery(true));
      }
      if (companies.length === 0) {
        throw new Error('Could not identify a valid focus company for this query.');
      }
      return alignConceptDiscoveryByMarket(companies);
  };

  const generateExpectationGapQuestions = async (
    company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language
  ): Promise<string[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const recencyGuidance = buildRecencyGuidance(new Date(), lang);

    const callOnce = async (strictLanguageRetry: boolean) => {
      const prompt = buildExpectationGapQuestionsPrompt(
        company,
        outputLanguage,
        recencyGuidance,
        strictLanguageRetry
      );
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'question_generation',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['questions'],
          },
        },
      });
      appendTelemetry('question_generation', startedAt, response);
      const parsed = parseModelJsonResponse(response.text || '{}') as { questions?: string[] };
      return (Array.isArray(parsed.questions) ? parsed.questions : []).slice(
        0,
        EXPECTATION_GAP_QUESTION_COUNT
      );
    };

    updateState({
      currentStage:
        lang === 'cn' ? '正在生成预期差研究问题...' : 'Generating expectation-gap questions...',
    });

    const raw = await callOnce(false);
    return pickLanguageValidQuestions(raw, lang, () => callOnce(true), EXPECTATION_GAP_QUESTION_COUNT);
  };

  const generateQuestions = async (
    company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language,
    questionCount: number
  ): Promise<string[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildRecencyGuidance(now, lang);
    const coreCount = getCoreQuestionCount(questionCount);

    const callBatch = async (
      batchSize: number,
      batchIndex: number,
      batchTotal: number,
      priorQuestionCount: number,
      strictLanguageRetry: boolean
    ) => {
      const prompt = buildGenerateQuestionsPrompt(
        company,
        outputLanguage,
        batchSize,
        recencyGuidance,
        { batchIndex, batchTotal, priorQuestionCount },
        strictLanguageRetry
      );
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'question_generation',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['questions'],
          },
        },
      });
      appendTelemetry('question_generation', startedAt, response);
      const parsed = parseModelJsonResponse(response.text || '{}') as { questions?: string[] };
      return (Array.isArray(parsed.questions) ? parsed.questions : []).slice(0, batchSize);
    };

    const standardQuestions = await generateQuestionsInBatches(
      coreCount,
      async (batchSize, batchIndex, batchTotal, priorQuestionCount) => {
        const raw = await callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, false);
        return pickLanguageValidQuestions(raw, lang, () =>
          callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, true),
          batchSize
        );
      },
      {
        onBatchComplete: (_all, batchIndex, batchTotal) => {
          if (batchTotal <= 1) return;
          updateState({
            currentStage:
              lang === 'cn'
                ? `生成研究问题 (${batchIndex + 1}/${batchTotal})...`
                : `Generating research questions (${batchIndex + 1}/${batchTotal})...`,
          });
        },
      }
    );

    const gapQuestions = await generateExpectationGapQuestions(company, lang);
    return mergeCoreAndExpectationGapQuestions(standardQuestions, gapQuestions, questionCount);
  };

  const generateFollowUpQuestions = async (
    company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
    lang: Language,
    questionCount: number,
    followUpContext: FollowUpRunContext
  ): Promise<string[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, now, lang);

    const callBatch = async (
      batchSize: number,
      batchIndex: number,
      batchTotal: number,
      priorQuestionCount: number,
      strictLanguageRetry: boolean
    ) => {
      const prompt = buildFollowUpQuestionsPrompt(
        company,
        outputLanguage,
        batchSize,
        recencyGuidance,
        followUpContext.baseline,
        followUpContext.priorConclusion,
        { batchIndex, batchTotal, priorQuestionCount },
        strictLanguageRetry
      );

      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'follow_up_question_generation',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['questions'],
          },
        },
      });
      appendTelemetry('follow_up_question_generation', startedAt, response);

      const parsed = parseModelJsonResponse(response.text || '{}') as { questions?: string[] };
      return (Array.isArray(parsed.questions) ? parsed.questions : []).slice(0, batchSize);
    };

    return generateQuestionsInBatches(
      questionCount,
      async (batchSize, batchIndex, batchTotal, priorQuestionCount) => {
        const raw = await callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, false);
        return pickLanguageValidQuestions(raw, lang, () =>
          callBatch(batchSize, batchIndex, batchTotal, priorQuestionCount, true),
          batchSize
        );
      },
      {
        onBatchComplete: (_all, batchIndex, batchTotal) => {
          if (batchTotal <= 1) return;
          updateState({
            currentStage:
              lang === 'cn'
                ? `生成跟进问题 (${batchIndex + 1}/${batchTotal})...`
                : `Generating follow-up questions (${batchIndex + 1}/${batchTotal})...`,
          });
        },
      }
    );
  };

  const answerQuestion = async (
    question: string,
    company: CompanyProfile,
    lang: Language
  ): Promise<QnAResult> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const basePrompt = buildAnswerQuestionPrompt(
      question,
      company,
      outputLanguage,
      buildRecencyGuidance(now, lang),
      lang
    );

    const callSearch = async (prompt: string, step: 'answer_question' | 'follow_up_answer_question') => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.search.provider,
        model: runtimeModelConfig.search.model,
        step,
        requireGoogleSearch: true,
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      appendTelemetry(step, startedAt, response);
      const sources: GroundingSource[] =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((chunk: any) => chunk.web)
          .filter(Boolean) ?? [];
      return { answer: response.text || '', sources };
    };

    let { answer, sources } = await callSearch(basePrompt, 'answer_question');
    if (isUnusableSearchAnswer(answer)) {
      throw new Error(
        lang === 'cn'
          ? '本题搜索未返回可用证据，将自动重试。'
          : 'Search returned no usable evidence for this question; retrying.'
      );
    }

    const mixCheck = detectWrongCompanyMix(answer, company);
    if (mixCheck.mixed) {
      console.warn(
        `[answerQuestion] Possible wrong-company mix for ${company.ticker}: ${mixCheck.reasons.join('; ')}`
      );
      const retry = await callSearch(
        `${basePrompt}${buildWrongCompanyRetryAppendix(company, lang, mixCheck.reasons)}`,
        'answer_question'
      );
      if (!isUnusableSearchAnswer(retry.answer)) {
        answer = retry.answer;
        sources = retry.sources;
      }
    }

    return { question, answer, sources };
  };

  const answerFollowUpQuestion = async (
    question: string,
    company: CompanyProfile,
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<QnAResult> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, now, lang);
    const basePrompt = `${buildVerifiedMarketContext(company, lang)}

${buildFollowUpAnswerPrompt(
      question,
      company,
      outputLanguage,
      recencyGuidance,
      followUpContext.baseline
    )}`;

    const callSearch = async (prompt: string) => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.search.provider,
        model: runtimeModelConfig.search.model,
        step: 'follow_up_answer_question',
        requireGoogleSearch: true,
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      appendTelemetry('follow_up_answer_question', startedAt, response);
      const sources: GroundingSource[] =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((chunk: any) => chunk.web)
          .filter(Boolean) ?? [];
      return { answer: response.text || '', sources };
    };

    let { answer, sources } = await callSearch(basePrompt);
    if (isUnusableSearchAnswer(answer)) {
      throw new Error(
        lang === 'cn'
          ? '本题搜索未返回可用证据，将自动重试。'
          : 'Search returned no usable evidence for this question; retrying.'
      );
    }

    const mixCheck = detectWrongCompanyMix(answer, company);
    if (mixCheck.mixed) {
      console.warn(
        `[answerFollowUpQuestion] Possible wrong-company mix for ${company.ticker}: ${mixCheck.reasons.join('; ')}`
      );
      const retry = await callSearch(
        `${basePrompt}${buildWrongCompanyRetryAppendix(company, lang, mixCheck.reasons)}`
      );
      if (!isUnusableSearchAnswer(retry.answer)) {
        answer = retry.answer;
        sources = retry.sources;
      }
    }

    return { question, answer, sources };
  };

  const synthesizeConclusion = async (
    company: CompanyProfile,
    qna: QnAResult[],
    lang: Language
  ): Promise<InvestmentConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const marketContext = buildVerifiedMarketContext(company, lang);
    const conclusionSectionSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['summary', 'evidence'],
    };

    const qnaPayload = qna.map(item => ({
      question: item.question,
      answer: item.answer,
      sources: item.sources,
    }));

    return synthesizeInvestmentConclusionBySections({
      companyName: company.name,
      outputLanguage,
      recencyGuidance: buildRecencyGuidance(new Date(), lang),
      qna: qnaPayload,
      marketContext,
      callSection: async (sectionKey: ThesisSectionKey, prompt: string) => {
        const startedAt = Date.now();
        const response = await ai.models.generateContent({
          provider: runtimeModelConfig.analysis.provider,
          model: runtimeModelConfig.analysis.model,
          step: 'synthesize_conclusion_section',
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                [sectionKey]: conclusionSectionSchema,
              },
              required: [sectionKey],
            },
          },
        });
        appendTelemetry('synthesize_conclusion_section', startedAt, response);
        const normalized = normalizeInvestmentConclusion(parseModelJsonResponse(response.text || '{}'));
        return { sectionKey, section: normalized[sectionKey] };
      },
    });
  };

  const synthesizeFollowUpConclusion = async (
    company: CompanyProfile,
    qna: QnAResult[],
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<InvestmentConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const marketContext = buildVerifiedMarketContext(company, lang);
    const recencyGuidance = `${buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, new Date(), lang)}

${buildFollowUpPriorContextBlock(followUpContext.baseline, followUpContext.priorConclusion, lang)}`;

    const conclusionSectionSchema = {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['summary', 'evidence'],
    };
    const qnaPayload = qna.map(item => ({
      question: item.question,
      answer: item.answer,
      sources: item.sources,
    }));

    return synthesizeInvestmentConclusionBySections({
      companyName: company.name,
      outputLanguage,
      recencyGuidance,
      qna: qnaPayload,
      marketContext,
      callSection: async (sectionKey: ThesisSectionKey, prompt: string) => {
        const startedAt = Date.now();
        const response = await ai.models.generateContent({
          provider: runtimeModelConfig.analysis.provider,
          model: runtimeModelConfig.analysis.model,
          step: 'follow_up_synthesize_conclusion_section',
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                [sectionKey]: conclusionSectionSchema,
              },
              required: [sectionKey],
            },
          },
        });
        appendTelemetry('follow_up_synthesize_conclusion_section', startedAt, response);
        const normalized = normalizeInvestmentConclusion(parseModelJsonResponse(response.text || '{}'));
        return { sectionKey, section: normalized[sectionKey] };
      },
    });
  };

  const generateFinalConclusion = async (
    company: CompanyProfile,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language
  ): Promise<FinalConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const marketContext = buildVerifiedMarketContext(company, lang);
    
    const finalConclusionSchema = {
        type: Type.OBJECT,
        properties: {
            overall_conclusion: { 
                type: Type.STRING,
                description: `Rating plus 3-5 sentence executive summary for ${company.name}.`
            },
            bullet_points: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        argument: { 
                            type: Type.STRING,
                            description: 'A single, key investment argument (pro or con).'
                        },
                        evidence: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: 'A list of specific data points or facts from the Q&A that support the argument.'
                        }
                    },
                    required: ['argument', 'evidence']
                }
            }
        },
        required: ['overall_conclusion', 'bullet_points']
    };

    const buildPrompt = (strict: boolean) => {
      const base = buildFinalConclusionPrompt(
        company.name,
        outputLanguage,
        buildRecencyGuidance(new Date(), lang),
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer, sources: item.sources })),
        marketContext
      );
      if (!strict) return base;
      return `${base}\n\n${buildFinalConclusionStrictRetrySuffix()}`;
    };

    const callModel = async (strict: boolean) => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'final_conclusion',
        contents: { role: 'user', parts: [{ text: buildPrompt(strict) }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: finalConclusionSchema,
        },
      });
      appendTelemetry('final_conclusion', startedAt, response);
      return normalizeFinalConclusion(parseModelJsonResponse(response.text || '{}'));
    };

    let finalConclusion = await callModel(false);
    if (!hasUsableFinalConclusion(finalConclusion)) {
      finalConclusion = await callModel(true);
    }
    if (!hasUsableFinalConclusion(finalConclusion)) {
      throw new Error(`Failed to generate a usable final investment conclusion for ${company.name}.`);
    }
    return finalConclusion;
  };

  const generateFollowUpFinalConclusion = async (
    company: CompanyProfile,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<FinalConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const recencyGuidance = buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, new Date(), lang);
    const marketContext = buildVerifiedMarketContext(company, lang);

    const buildPrompt = (strict: boolean) => {
      const base = `${marketContext}

${buildFollowUpFinalConclusionPrompt(
        company.name,
        outputLanguage,
        recencyGuidance,
        followUpContext.baseline,
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer }))
      )}`;
      if (!strict) return base;
      return `${base}

CRITICAL RETRY: Include valid "vs_prior" with rating_change (upgrade/maintain/downgrade) and 3-5 bullet_points.`;
    };

    const callModel = async (strict: boolean) => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'follow_up_final_conclusion',
        contents: { role: 'user', parts: [{ text: buildPrompt(strict) }] },
        config: {
          responseMimeType: 'application/json',
        },
      });
      appendTelemetry('follow_up_final_conclusion', startedAt, response);
      return normalizeFinalConclusion(parseModelJsonResponse(response.text || '{}'));
    };

    let finalConclusion = await callModel(false);
    if (!hasUsableFinalConclusion(finalConclusion)) {
      finalConclusion = await callModel(true);
    }
    if (!hasUsableFinalConclusion(finalConclusion)) {
      throw new Error(`Failed to generate a usable follow-up conclusion for ${company.name}.`);
    }
    return finalConclusion;
  };

  const generateCompanyQuickTake = async (
    company: CompanyProfile,
    lang: Language
  ): Promise<string> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const resolvedCurrency = resolveMarketCurrency(company.exchange, company.currency);
    const marketCapLabel = formatMarketCapForPrompt(
      company.marketCap,
      lang,
      company.exchange,
      resolvedCurrency
    );
    const floatMarketCapLabel = formatMarketCapForPrompt(
      company.floatMarketCap,
      lang,
      company.exchange,
      resolvedCurrency
    );
    const marketCapRule = buildMarketCapPromptRule(
      marketCapLabel,
      company.exchange,
      resolvedCurrency,
      lang
    );
    const prompt = `You are writing a sharp "at-a-glance" company brief in ${outputLanguage}.

Target company:
- Name: ${company.name}
- Ticker/Exchange: ${company.ticker} (${company.exchange})
- Market cap (verified): ${marketCapLabel}
- Float market cap (verified): ${floatMarketCapLabel}

Reference writing style (must emulate this level of concreteness and directness):
"Rocket Lab (RKLB) is the second-largest commercial space company in the U.S. after SpaceX, and a key player in high-frequency small-satellite launches. Its core model is an end-to-end space stack: it not only earns launch revenue, but also manufactures satellites and mission-critical components, offering integrated build+launch services to monetize across the full value chain."

Hard requirements:
1) Output EXACTLY 2 sentences.
2) Sentence 1: state company identity + relative position/role in its market + scale signal. If mentioning market cap, copy the verified market cap text exactly: 「${marketCapLabel}」.
3) Sentence 2: explain the monetization model concretely (how it makes money, key products/services, value-chain position).
4) Use concrete industry wording; no generic filler.
5) Forbidden vague phrases (or their equivalents): "core product and service model", "certain differentiation", "comprehensive conclusion", "etc.".
6) No markdown, no bullet points, no disclaimer.
${marketCapRule}
${buildQuickTakeIdentityRule(company, lang)}`;

    const startedAt = Date.now();
    const response = await ai.models.generateContent({
      provider: runtimeModelConfig.analysis.provider,
      model: runtimeModelConfig.analysis.model,
      step: 'quick_take',
      contents: { role: 'user', parts: [{ text: prompt }] },
    });
    appendTelemetry('quick_take', startedAt, response);

    const raw = (response.text || '').replace(/\s+/g, ' ').trim();
    return sanitizeQuickTakeMarketCap(raw, company, lang);
  };

  const runAnalysisForCompany = async (
    companyId: string,
    company: CompanyProfile,
    lang: Language,
    questionCount: number,
    existing?: CompanyAnalysis | null,
    followUpContext?: FollowUpRunContext | null
  ) => {
    const uiText = getUIText(lang);
    const isFollowUp = Boolean(followUpContext);
    const progressRunId = createQnaProgressRunId(companyId, company.name);
    registerQnaProgressRun(companyId, progressRunId, company.name);
    logQnaProgress('RUN_START', {
      runId: progressRunId,
      companyId,
      companyName: company.name,
      questionCountTarget: questionCount,
      existingStatus: existing?.status ?? null,
      existingQuestionsLen: existing?.questions?.length ?? 0,
      existingQnaLen: existing?.qna?.length ?? 0,
      sessionId: analysisStateRef.current.id,
    });
    let completedCount = 0;
    let totalQuestions = questionCount;
    try {
      const existingQuestions = Array.isArray(existing?.questions) ? existing!.questions : [];
      const existingQna = Array.isArray(existing?.qna) ? existing!.qna : [];
      const existingConclusion = hasUsableInvestmentConclusion(existing?.conclusion) ? existing!.conclusion : null;
      const existingFinalConclusion = hasUsableFinalConclusion(existing?.finalConclusion) ? existing!.finalConclusion : null;

      let questions = existingQuestions;
      if (!questions.length) {
        updateState({
          currentStage: isFollowUp ? uiText.followUpGeneratingQuestions : uiText.generatingQuestions,
          currentProgress: 20,
        });
        updateCompanyState(companyId, { status: 'generating_questions' });
        questions = await runWithStepLog(
          companyId,
          company.name,
          'generate_questions',
          lang,
          () =>
            isFollowUp && followUpContext
              ? generateFollowUpQuestions(company, lang, questionCount, followUpContext)
              : generateQuestions(company, lang, questionCount)
        );
        updateCompanyState(companyId, { questions });
        logQnaProgress('QUESTIONS_GENERATED', {
          runId: progressRunId,
          companyName: company.name,
          count: questions.length,
          previews: questions.slice(0, 3).map((q, i) => ({ index: i, preview: q.slice(0, 60) })),
        });
        await delay(300);
      }

      totalQuestions = questions.length || questionCount;

      updateCompanyState(companyId, { status: 'answering_questions' });
      const { qnaByQuestion, pendingIndices } = indexAnsweredQuestions(questions, existingQna);
      completedCount = countAnsweredQuestions(questions, qnaByQuestion);
      const progressReporter = new QnaProgressReporter(
        progressRunId,
        companyId,
        company.name,
        totalQuestions
      );

      logQnaProgress('QNA_INDEXED', {
        runId: progressRunId,
        companyName: company.name,
        totalQuestions,
        pendingCount: pendingIndices.length,
        pendingIndicesPreview: pendingIndices.slice(0, 8),
        ...snapshotQnaMaps(questions, qnaByQuestion),
        existingQnaLen: existingQna.length,
        countedViaHelper: completedCount,
      });

      if (completedCount > 0) {
        updateCompanyState(companyId, { qna: orderQnaByQuestions(questions, qnaByQuestion) });
      }

      const reportQnaProgress = (completed: number, source: string, extra?: Record<string, unknown>) => {
        const safeCompleted = Math.min(completed, totalQuestions);
        progressReporter.report(source, safeCompleted, extra);
        updateState({
          currentStage: (lang === 'cn'
            ? `${company.name}：已完成 ${safeCompleted}/${totalQuestions} 题...`
            : `${company.name}: Completed ${safeCompleted}/${totalQuestions} questions...`),
          currentProgress: 20 + Math.floor((safeCompleted / totalQuestions) * 50),
        });
      };

      reportQnaProgress(completedCount, 'initial');

      if (pendingIndices.length > 0) {
        const pendingTasks = pendingIndices.map(index => ({
          index,
          item: questions[index],
        }));

        await runWithStepLog(companyId, company.name, 'answer_questions', lang, () =>
          runParallelIndexedTasks<string, QnAResult>(
            pendingTasks,
            async task => {
              logQnaProgress('TASK_START', {
                runId: progressRunId,
                taskIndex: task.index,
                questionPreview: task.item.slice(0, 80),
              });
              return isFollowUp && followUpContext
                ? answerFollowUpQuestion(task.item, company, lang, followUpContext)
                : answerQuestion(task.item, company, lang);
            },
            {
              concurrency: QNA_CONCURRENCY,
              onTaskComplete: async (result, task, completedInBatch, batchTotal) => {
                const questionKey = questions[task.index];
                const normalizedKey = questionKey?.trim() || '';
                const beforeSnapshot = snapshotQnaMaps(questions, qnaByQuestion);
                const beforeCount = completedCount;

                qnaByQuestion.set(questionKey, { ...result, question: questionKey });
                completedCount = countAnsweredQuestions(questions, qnaByQuestion);
                const afterSnapshot = snapshotQnaMaps(questions, qnaByQuestion);

                logQnaProgress('TASK_COMPLETE', {
                  runId: progressRunId,
                  taskIndex: task.index,
                  completedInBatch,
                  batchTotal,
                  questionKeyPreview: questionKey.slice(0, 80),
                  normalizedKeyPreview: normalizedKey.slice(0, 80),
                  keyUsesRawNotNormalized: questionKey !== normalizedKey,
                  beforeCount,
                  afterCount: completedCount,
                  countDelta: completedCount - beforeCount,
                  ...afterSnapshot,
                  mapKeysAdded: afterSnapshot.mapRawKeyCount - beforeSnapshot.mapRawKeyCount,
                });

                if (completedCount < beforeCount) {
                  const diagnosis = diagnoseQuestionCount(questions, qnaByQuestion);
                  logQnaProgress('COUNT_DROP_IN_TASK', {
                    runId: progressRunId,
                    taskIndex: task.index,
                    beforeCount,
                    afterCount: completedCount,
                    notCountedRows: diagnosis.rows.filter(r => !r.counted && (r.hasAnswer || r.mapHitRaw || r.mapHitNormalized)),
                  });
                }

                updateCompanyState(companyId, { qna: orderQnaByQuestions(questions, qnaByQuestion) });
                reportQnaProgress(completedCount, `task#${task.index}`, {
                  taskIndex: task.index,
                  completedInBatch,
                });
              },
            }
          )
        );
      }

      const qnaResults = orderQnaByQuestions(questions, qnaByQuestion);
      if (qnaResults.length < questions.length) {
        throw new Error(
          lang === 'cn'
            ? `仅完成 ${qnaResults.length}/${questions.length} 个问题，请重试以继续未完成项。`
            : `Only ${qnaResults.length}/${questions.length} questions answered. Retry to continue remaining items.`
        );
      }

      let conclusion = existingConclusion;
      if (!conclusion) {
        updateState({ currentStage: uiText.synthesizingReport, currentProgress: 75 });
        updateCompanyState(companyId, { status: 'synthesizing' });
        conclusion = await runWithStepLog(
          companyId,
          company.name,
          'synthesize_conclusion',
          lang,
          () =>
            isFollowUp && followUpContext
              ? synthesizeFollowUpConclusion(company, qnaResults, lang, followUpContext)
              : synthesizeConclusion(company, qnaResults, lang)
        );
        updateCompanyState(companyId, { conclusion });
        await delay(200);
      } else {
        updateCompanyState(companyId, { conclusion });
      }

      let finalConclusion = existingFinalConclusion;
      if (!finalConclusion) {
        updateState({ currentStage: uiText.generatingFinalConclusion, currentProgress: 90 });
        finalConclusion = await runWithStepLog(
          companyId,
          company.name,
          'final_conclusion',
          lang,
          () =>
            isFollowUp && followUpContext
              ? generateFollowUpFinalConclusion(
                  company,
                  qnaResults,
                  conclusion!,
                  lang,
                  followUpContext
                )
              : generateFinalConclusion(company, qnaResults, conclusion!, lang)
        );
      }
      updateCompanyState(companyId, { finalConclusion, status: 'complete' });

      const reportId = analysisStateRef.current.id;
      void recordCompanyUsage({
        reportId,
        companyId,
        ticker: company.ticker,
      }).then(() => notifyUsageUpdated());

      updateState({
        currentStage:
          lang === 'cn'
            ? `${company.name}：分析完成`
            : `${company.name}: analysis complete`,
        currentProgress: 100,
      });

      logQnaProgress('RUN_END', {
        runId: progressRunId,
        companyName: company.name,
        finalCompletedCount: completedCount,
        totalQuestions,
      });
    } catch (e) {
      console.error(`Error analyzing ${company.name}:`, e);
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      logQnaProgress('RUN_ERROR', {
        runId: progressRunId,
        companyName: company.name,
        error: errorMessage,
        completedCountAtError: completedCount,
      });
      updateCompanyState(companyId, { status: 'error', error: errorMessage });
      throw e;
    } finally {
      unregisterQnaProgressRun(companyId, progressRunId);
    }
  };

  const persistAnalysisState = useCallback(async (state: AnalysisState, lang: Language) => {
    const uiText = getUIText(lang);
    const isPartial = state.status === 'partial';
    const hasSavedCandidates = (state.candidateCompanies || []).some(c => isCompanyAnalysisComplete(c));
    setSaveStatus('saving');
    setSaveMessage(
      isPartial && !hasSavedCandidates
        ? uiText.savingFocusReport
        : uiText.savingReport
    );
    try {
      const payload = {
        ...state,
        clientSessionId: state.clientSessionId || state.id,
      };
      const response = await apiFetch(`/api/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          result: payload,
          query: payload.query,
          language: payload.language,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save report (${response.status})`);
      }

      const sessionKey = payload.clientSessionId || payload.id;
      const pending = loadPendingSaves().filter(item => item?.result?.id !== sessionKey);
      savePendingSaves(pending);
      await refreshHistory();
      setSaveStatus('success');
      setSaveMessage(
        isPartial && !hasSavedCandidates
          ? uiText.focusReportSaved
          : isPartial
            ? uiText.progressReportSaved
            : uiText.saveSuccess
      );
    } catch (error) {
      console.error('Error saving report to server:', error);
      const message = error instanceof Error ? error.message : 'Failed to save report';
      enqueuePendingSave({
        result: state,
        query: state.query,
        language: state.language,
        queuedAt: new Date().toISOString(),
      });
      setSaveStatus('error');
      setSaveMessage(
        `${getUIText(lang).saveFailed}: ${message}. ${
          lang === 'cn'
            ? '报告已缓存到本地，网络恢复后会自动重试保存。'
            : 'Report cached locally and will auto-retry saving.'
        }`
      );
    }
  }, [refreshHistory, enqueuePendingSave, loadPendingSaves, savePendingSaves]);

  const persistCurrentAnalysis = useCallback(async (
    overrides: Partial<AnalysisState>,
    lang: Language
  ) => {
    const snapshot = snapshotForPersist(overrides);
    commitAnalysisState(() => snapshot);
    await persistAnalysisState(snapshot, lang);
    return snapshot;
  }, [snapshotForPersist, commitAnalysisState, persistAnalysisState]);

  const finalizeAnalysisAsComplete = useCallback(async (lang: Language) => {
    const state = analysisStateRef.current;
    const allCompanies = [state.focusCompany, ...(state.candidateCompanies || [])].filter(
      Boolean
    ) as CompanyAnalysis[];

    const incomplete = findIncompleteCompanies(allCompanies);
    if (incomplete.length > 0) {
      const names = incomplete.map(c => c.profile.name).join(', ');
      throw new Error(
        lang === 'cn'
          ? `以下公司缺少投资论点或最终结论：${names}`
          : `Missing investment thesis or final conclusion for: ${names}`
      );
    }

    const committed = commitAnalysisState(() =>
      snapshotForPersist({
        status: 'complete',
        error: null,
        currentStage: getUIText(lang).analysisComplete,
        currentProgress: 100,
        llmTelemetry: telemetryRef.current,
      })
    );
    await persistAnalysisState(committed, lang);
  }, [persistAnalysisState, commitAnalysisState, snapshotForPersist]);

  const startAnalysis = useCallback(async (query: string, lang: Language) => {
    const id = Date.now().toString();
    setSaveStatus('idle');
    setSaveMessage('');
    telemetryRef.current = [];

    commitAnalysisState(() => ({
      ...createInitialState(),
      id,
      timestamp: new Date().toISOString(),
      status: 'finding_companies',
      query,
      language: lang,
      currentStage: getUIText(lang).findingCompanies,
      currentProgress: 5,
      stepLogs: [],
      clientSessionId: id,
    }));

    try {
      await checkUsageQuota(1);
    } catch (error) {
      commitAnalysisState(() => createInitialState());
      const message = formatUsageLimitMessage(error, lang);
      alert(message);
      return;
    }

    void apiFetch('/api/analytics/event', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'analysis_start', metadata: { query } }),
    }).catch(() => undefined);

    try {
      await syncRuntimeModelConfigFromUserSettings();
        let companyProfiles: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

        await runWithStepLog('session', query, 'find_companies', lang, async () => {
        let exactMatch = await searchTicker(query);
        if (!exactMatch) {
          exactMatch = await searchTickerViaServer(query);
        }

        if (exactMatch) {
            updateState({ currentStage: `Found ${exactMatch.ticker}. Finding competitors...`, currentProgress: 7 });
            let competitors = await findCompetitors(exactMatch, lang);
            if (competitors.length === 0) {
              try {
                const conceptCandidates = await findCompaniesByConcept(exactMatch.name, lang);
                competitors = prioritizeCompetitorsByMarket(
                  exactMatch,
                  conceptCandidates.filter(c => c.ticker.toUpperCase() !== exactMatch.ticker.toUpperCase()),
                  2
                );
              } catch {
                // keep empty competitors if fallback discovery also fails
              }
            }
            companyProfiles = [exactMatch, ...competitors];
        } else {
            updateState({ currentStage: `No exact ticker found. Searching for concept: "${query}"...`, currentProgress: 7 });
            try {
              companyProfiles = await findCompaniesByConcept(query, lang);
            } catch (conceptError) {
              // Fallback: try deterministic ticker search again before failing.
              const fallbackMatch = (await searchTicker(query)) || (await searchTickerViaServer(query));
              if (fallbackMatch) {
                const competitors = await findCompetitors(fallbackMatch, lang);
                companyProfiles = [fallbackMatch, ...competitors];
              } else {
                throw conceptError;
              }
            }
        }
        });

        const validCompanyProfiles = companyProfiles.filter(isValidCompanyProfile);

        if (validCompanyProfiles.length === 0) {
            throw new Error("Could not identify any companies for the given query.");
        }
      
        updateState({ currentStage: 'Fetching financial data...', currentProgress: 15 });

        const enrichedProfiles = await runWithStepLog(
          'session',
          query,
          'fetch_financials',
          lang,
          () => Promise.all(validCompanyProfiles.map(p => getFinancialData(p)))
        );

        const focusProfile = enrichedProfiles[0];
        const candidateProfiles = enrichedProfiles.slice(1);
        const companyQuickTakes = await Promise.all(
          enrichedProfiles.map((profile, idx) =>
            runWithStepLog(
              idx === 0 ? focusProfile.ticker : profile.ticker,
              profile.name,
              'quick_take',
              lang,
              () => generateCompanyQuickTake(profile, lang)
            )
          )
        );

        const focusAnalysis: CompanyAnalysis = { id: focusProfile.ticker, profile: focusProfile, quickTake: companyQuickTakes[0] || null, status: 'pending', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] };
        const candidateAnalyses: CompanyAnalysis[] = candidateProfiles.map((p, idx) => ({ id: p.ticker, profile: p, quickTake: companyQuickTakes[idx + 1] || null, status: 'awaiting_user', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] }));

        updateState({
            status: 'analyzing',
            focusCompany: focusAnalysis,
            candidateCompanies: candidateAnalyses,
            currentStage: getUIText(lang).analyzingCompany.replace('{companyName}', focusProfile.name),
            clientSessionId: id,
        });

        await runAnalysisForCompany(focusAnalysis.id, focusProfile, lang, runtimeModelConfig.questions.focus);
        if (!isCompanyAnalysisComplete(analysisStateRef.current.focusCompany)) {
          throw new Error(
            lang === 'cn'
              ? `${focusProfile.name} 的分析结果未能写入状态，请重试。`
              : `Failed to persist analysis results for ${focusProfile.name}. Please retry.`
          );
        }

        await persistCurrentAnalysis(
          {
            status: 'partial',
            error: null,
            currentStage: getUIText(lang).focusAnalysisSaved,
            currentProgress: 100,
            llmTelemetry: telemetryRef.current,
            candidateCompanies: analysisStateRef.current.candidateCompanies.map(c => ({
              ...c,
              status: isCandidateAwaitingUser(c) ? 'awaiting_user' : c.status,
            })),
          },
          lang
        );

    } catch (e) {
        console.error("Analysis failed:", e);
        const errorMessage = e instanceof Error ? e.message : 'Failed to complete analysis.';
        updateState({ status: 'error', error: errorMessage, currentStage: getUIText(lang).errorTitle });
    }
  }, [runtimeModelConfig, searchTickerViaServer, persistCurrentAnalysis, syncRuntimeModelConfigFromUserSettings, commitAnalysisState]);

  const startCandidateAnalysis = useCallback(async (companyId: string) => {
    const state = analysisStateRef.current;
    const lang = state.language;
    const uiText = getUIText(lang);
    const company = state.candidateCompanies.find(c => c.id === companyId);
    if (!company) return;
    if (isCompanyAnalysisComplete(company)) return;
    if (company.status !== 'awaiting_user' && company.status !== 'error' && company.status !== 'pending') {
      return;
    }

    const previousSessionStatus = state.status;
    const previousStage = state.currentStage;
    const previousProgress = state.currentProgress;
    const previousCompanyStatus = company.status;
    const previousCompanyError = company.error;

    commitAnalysisState(prev => ({
      ...prev,
      status: 'analyzing',
      error: null,
      currentStage: uiText.analyzingCompany.replace('{companyName}', company.profile.name),
      currentProgress: 20,
      candidateCompanies: prev.candidateCompanies.map(candidate =>
        candidate.id === companyId
          ? { ...candidate, status: 'generating_questions' as const, error: undefined }
          : candidate
      ),
    }));

    try {
      await checkUsageQuota(1);
    } catch (error) {
      commitAnalysisState(prev => ({
        ...prev,
        status: previousSessionStatus,
        currentStage: previousStage,
        currentProgress: previousProgress,
        candidateCompanies: prev.candidateCompanies.map(candidate =>
          candidate.id === companyId
            ? {
                ...candidate,
                status: previousCompanyStatus,
                error: previousCompanyError,
              }
            : candidate
        ),
      }));
      const message = formatUsageLimitMessage(error, lang);
      alert(message);
      return;
    }

    void apiFetch('/api/analytics/event', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'candidate_analysis_start',
        metadata: { companyId, ticker: company.profile.ticker },
      }),
    }).catch(() => undefined);

    try {
      await runAnalysisForCompany(
        companyId,
        company.profile,
        lang,
        runtimeModelConfig.questions.candidate,
        company
      );

      if (!isCompanyAnalysisComplete(analysisStateRef.current.candidateCompanies.find(c => c.id === companyId))) {
        throw new Error(
          lang === 'cn'
            ? `${company.profile.name} 的分析结果未能写入状态，请重试。`
            : `Failed to persist analysis results for ${company.profile.name}. Please retry.`
        );
      }

      const allStartedComplete =
        isCompanyAnalysisComplete(analysisStateRef.current.focusCompany) &&
        analysisStateRef.current.candidateCompanies.every(c => isCompanyAnalysisComplete(c));

      const snapshot = snapshotForPersist({
        status: allStartedComplete ? 'complete' : 'partial',
        error: null,
        currentStage: allStartedComplete
          ? uiText.analysisComplete
          : uiText.focusAnalysisSaved,
        currentProgress: 100,
        llmTelemetry: telemetryRef.current,
      });

      const savedCandidate = snapshot.candidateCompanies.find(c => c.id === companyId);
      if (!isCompanyAnalysisComplete(savedCandidate)) {
        throw new Error(
          lang === 'cn'
            ? `${company.profile.name} 的结论未能写入保存快照，请重试。`
            : `Conclusions for ${company.profile.name} were missing from the save snapshot. Please retry.`
        );
      }

      commitAnalysisState(() => snapshot);
      await persistAnalysisState(snapshot, lang);
    } catch (e) {
      console.error(`Candidate analysis failed for ${company.profile.name}:`, e);
      const errorMessage = e instanceof Error ? e.message : 'Failed to analyze candidate.';
      const partialSnapshot = snapshotForPersist({
        status: 'partial',
        error: errorMessage,
        currentStage: uiText.errorTitle,
        candidateCompanies: analysisStateRef.current.candidateCompanies.map(c =>
          c.id === companyId
            ? { ...c, status: 'error' as const, error: errorMessage }
            : c
        ),
      });
      commitAnalysisState(() => partialSnapshot);
      await persistAnalysisState(partialSnapshot, lang);
    }
  }, [persistAnalysisState, runtimeModelConfig.questions.candidate, commitAnalysisState, snapshotForPersist]);

  const startFollowUpAnalysis = useCallback(async (
    parentState: AnalysisState,
    options?: { companyIds?: string[] }
  ) => {
    const lang = parentState.language;
    const uiText = getUIText(lang);
    const eligible = getFollowUpEligibleCompanies(parentState);
    const targetCompanies = options?.companyIds?.length
      ? eligible.filter(company => options.companyIds!.includes(company.id))
      : eligible;

    if (targetCompanies.length === 0) {
      throw new Error(uiText.followUpNoEligible);
    }

    try {
      await checkUsageQuota(targetCompanies.length);
    } catch (error) {
      const message = formatUsageLimitMessage(error, lang);
      alert(message);
      return;
    }

    void apiFetch('/api/analytics/event', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'follow_up_start',
        metadata: { companyCount: targetCompanies.length, parentId: parentState.id },
      }),
    }).catch(() => undefined);

    const id = Date.now().toString();
    const parentTimestamp = parentState.timestamp;
    const baselines: Record<string, FollowUpBaseline> = {};
    for (const company of targetCompanies) {
      baselines[company.id] = extractFollowUpBaseline(company, parentTimestamp);
    }

    const followUpMeta: FollowUpMeta = {
      parentAnalysisId: parentState.id,
      parentTimestamp,
      parentQuery: parentState.query,
      baselines,
    };

    setSaveStatus('idle');
    setSaveMessage('');
    telemetryRef.current = [];
    await syncRuntimeModelConfigFromUserSettings();

    setAnalysisState({
      ...createInitialState(),
      id,
      timestamp: new Date().toISOString(),
      status: 'analyzing',
      query: buildFollowUpQueryLabel(parentState.query, targetCompanies, lang),
      language: lang,
      analysisType: 'follow_up',
      followUpMeta,
      currentStage: uiText.followUpLoadingPrices,
      currentProgress: 10,
    });

    try {
      const enrichedProfiles = await Promise.all(
        targetCompanies.map(company => getFinancialData(company.profile))
      );

      const buildCompanyAnalysis = (
        parentCompany: CompanyAnalysis,
        refreshedProfile: CompanyProfile
      ): CompanyAnalysis => ({
        id: parentCompany.id,
        profile: refreshedProfile,
        quickTake: parentCompany.quickTake ?? null,
        priorBaseline: baselines[parentCompany.id],
        status: 'pending',
        questions: [],
        qna: [],
        conclusion: null,
        finalConclusion: null,
        followUpQuestions: [],
      });

      let focusAnalysis: CompanyAnalysis | null = null;
      let candidateAnalyses: CompanyAnalysis[] = [];

      if (targetCompanies.length === 1) {
        focusAnalysis = buildCompanyAnalysis(targetCompanies[0], enrichedProfiles[0]);
      } else {
        const parentFocusId = parentState.focusCompany?.id;
        targetCompanies.forEach((parentCompany, index) => {
          const analysis = buildCompanyAnalysis(parentCompany, enrichedProfiles[index]);
          if (parentFocusId && parentCompany.id === parentFocusId) {
            focusAnalysis = analysis;
          } else {
            candidateAnalyses.push(analysis);
          }
        });
        if (!focusAnalysis && candidateAnalyses.length > 0) {
          focusAnalysis = candidateAnalyses.shift()!;
        }
      }

      if (!focusAnalysis) {
        throw new Error(uiText.followUpNoEligible);
      }

      updateState({
        focusCompany: focusAnalysis,
        candidateCompanies: candidateAnalyses,
        currentStage: getUIText(lang).analyzingCompany.replace(
          '{companyName}',
          focusAnalysis.profile.name
        ),
        currentProgress: 15,
      });

      const runFollowUpForCompany = async (companyAnalysis: CompanyAnalysis, parentCompany: CompanyAnalysis) => {
        const followUpContext: FollowUpRunContext = {
          baseline: baselines[companyAnalysis.id],
          priorConclusion: parentCompany.conclusion,
          parentTimestamp,
        };
        await runAnalysisForCompany(
          companyAnalysis.id,
          companyAnalysis.profile,
          lang,
          DEFAULT_FOLLOW_UP_QUESTION_COUNT,
          companyAnalysis,
          followUpContext
        );
      };

      const parentById = new Map(targetCompanies.map(company => [company.id, company]));

      await runFollowUpForCompany(focusAnalysis, parentById.get(focusAnalysis.id)!);
      if (!isCompanyAnalysisComplete(analysisStateRef.current.focusCompany)) {
        throw new Error(
          lang === 'cn'
            ? `${focusAnalysis.profile.name} 的跟进分析未能完成，请重试。`
            : `Follow-up analysis failed to complete for ${focusAnalysis.profile.name}. Please retry.`
        );
      }

      if (candidateAnalyses.length > 0) {
        await delay(2000);
      }

      for (const candidate of candidateAnalyses) {
        updateState({
          currentStage: getUIText(lang).analyzingCompany.replace(
            '{companyName}',
            candidate.profile.name
          ),
        });
        await runFollowUpForCompany(candidate, parentById.get(candidate.id)!);
        if (
          !isCompanyAnalysisComplete(
            analysisStateRef.current.candidateCompanies.find(item => item.id === candidate.id)
          )
        ) {
          throw new Error(
            lang === 'cn'
              ? `${candidate.profile.name} 的跟进分析未能完成，请重试。`
              : `Follow-up analysis failed to complete for ${candidate.profile.name}. Please retry.`
          );
        }
        await delay(2000);
      }

      await finalizeAnalysisAsComplete(lang);
    } catch (error) {
      console.error('Follow-up analysis failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to complete follow-up analysis.';
      updateState({
        status: 'error',
        error: errorMessage,
        currentStage: uiText.errorTitle,
      });
    }
  }, [finalizeAnalysisAsComplete, syncRuntimeModelConfigFromUserSettings]);

  const resetAnalysis = useCallback(() => {
    setAnalysisState(createInitialState());
  }, []);

  const loadFromHistory = useCallback(async (id: string, preloaded?: AnalysisState) => {
    setLoadingReportId(id);
    try {
      const hasFullQna = (item: AnalysisState) =>
        Boolean(
          item.focusCompany?.qna?.length ||
            item.candidateCompanies?.some(company => company.qna?.length)
        );

      const listItem = preloaded || history.find(item => item.id === id);
      const fullPayload = preloaded && hasFullQna(preloaded) ? preloaded : null;

      if (listItem && !fullPayload) {
        setAnalysisState(normalizeReportOnLoad({ ...listItem, id, status: 'complete' }));
      }

      const raw = fullPayload
        ? { ...fullPayload, id: fullPayload.id || id }
        : await fetchReportById(id);
      const report = normalizeReportOnLoad({ ...raw, id });
      setAnalysisState(report);
      setHistory(prev => {
        const exists = prev.some(
          item =>
            item.id === id ||
            (report.clientSessionId && item.clientSessionId === report.clientSessionId)
        );
        const slimmed = slimHistoryItem({ ...report, id });
        if (!exists) {
          return [slimmed, ...prev];
        }
        return prev.map(item =>
          item.id === id ||
          (report.clientSessionId && item.clientSessionId === report.clientSessionId)
            ? slimmed
            : item
        );
      });
      setHistoryError(null);
    } catch (error) {
      console.error('Error loading report from history:', error);
      const cached = history.find(item => item.id === id);
      if (cached) {
        setAnalysisState(normalizeReportOnLoad({ ...cached, id, status: 'complete' }));
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          'Report load timed out — the report may be very large. Retry in a moment or refresh the batch queue and open again.'
        );
      }
      throw error;
    } finally {
      setLoadingReportId(null);
    }
  }, [history, fetchReportById]);

  const deleteFromHistory = useCallback(async (id: string) => {
    // Delete from server
    try {
      const response = await apiFetch(`/api/history/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        // 404 is okay (item might not exist on server)
        throw new Error(`Failed to delete report from server: ${response.statusText}`);
      }

      // Refresh history from server after deletion
      await refreshHistory();
    } catch (error) {
      console.error('Error deleting report from server:', error);
      // Still update local state to provide immediate feedback
      setHistory(prev => prev.filter(item => item.id !== id));
    }

    // Clear active state if it matches the deleted item
    setAnalysisState(current => {
      if (current.id === id && current.status === 'complete') {
        return createInitialState();
      }
      return current;
    });
  }, [refreshHistory]);

  const clearHistory = useCallback(async () => {
    // Clear from server
    try {
      const response = await apiFetch(`/api/history`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to clear history from server: ${response.statusText}`);
      }

      // Refresh history from server (should be empty now)
      await refreshHistory();
    } catch (error) {
      console.error('Error clearing history from server:', error);
      // Still clear local state to provide immediate feedback
      setHistory([]);
    }
  }, [refreshHistory]);

  const dismissSaveNotice = useCallback(() => {
    setSaveStatus('idle');
    setSaveMessage('');
  }, []);

  const retryLastAnalysis = useCallback(() => {
    const current = analysisStateRef.current;
    if (!current?.query) return;
    if (!current.focusCompany) {
      void startAnalysis(current.query, current.language);
      return;
    }

    const isCompanyComplete = (company: CompanyAnalysis | null | undefined) =>
      isCompanyAnalysisComplete(company);

    void (async () => {
      const lang = current.language;
      try {
        await syncRuntimeModelConfigFromUserSettings();
        telemetryRef.current = Array.isArray(current.llmTelemetry) ? [...current.llmTelemetry] : [];
        updateState({
          status: 'analyzing',
          error: null,
          currentStage: lang === 'cn' ? '从中断点继续分析...' : 'Resuming from interruption...',
          currentProgress: Math.max(20, current.currentProgress || 0),
        });

        const resetIfStuck = (companyId: string) => {
          updateCompanyState(companyId, { status: 'pending', error: undefined });
        };

        const focus = analysisStateRef.current.focusCompany;
        if (focus && !isCompanyComplete(focus)) {
          if (focus.status === 'error' || focus.status === 'generating_questions') {
            resetIfStuck(focus.id);
          }
          updateState({
            currentStage: getUIText(lang).generatingQuestions,
            currentProgress: 20,
          });
          const followUpContext =
            current.analysisType === 'follow_up' && current.followUpMeta && focus.priorBaseline
              ? {
                  baseline: focus.priorBaseline,
                  priorConclusion: null,
                  parentTimestamp: current.followUpMeta.parentTimestamp,
                }
              : null;
          await runAnalysisForCompany(
            focus.id,
            focus.profile,
            lang,
            focus.questions?.length ||
              (followUpContext ? DEFAULT_FOLLOW_UP_QUESTION_COUNT : runtimeModelConfig.questions.focus),
            focus,
            followUpContext
          );
        }

        const candidates = analysisStateRef.current.candidateCompanies || [];
        for (const candidate of candidates) {
          if (isCandidateAwaitingUser(candidate)) continue;
          if (isCompanyComplete(candidate)) continue;
          if (candidate.status === 'error' || candidate.status === 'generating_questions') {
            resetIfStuck(candidate.id);
          }
          updateState({
            currentStage: getUIText(lang).generatingQuestions,
            currentProgress: 20,
          });
          const followUpContext =
            current.analysisType === 'follow_up' && current.followUpMeta && candidate.priorBaseline
              ? {
                  baseline: candidate.priorBaseline,
                  priorConclusion: null,
                  parentTimestamp: current.followUpMeta.parentTimestamp,
                }
              : null;
          await runAnalysisForCompany(
            candidate.id,
            candidate.profile,
            lang,
            candidate.questions?.length ||
              (followUpContext ? DEFAULT_FOLLOW_UP_QUESTION_COUNT : runtimeModelConfig.questions.candidate),
            candidate,
            followUpContext
          );
        }

        await finalizeAnalysisAsComplete(lang);
      } catch (e) {
        console.error('Resume analysis failed:', e);
        const errorMessage = e instanceof Error ? e.message : 'Failed to resume analysis.';
        updateState({ status: 'error', error: errorMessage, currentStage: getUIText(lang).errorTitle });
      }
    })();
  }, [startAnalysis, runtimeModelConfig.questions.candidate, runtimeModelConfig.questions.focus, finalizeAnalysisAsComplete, syncRuntimeModelConfigFromUserSettings]);

  return { 
    analysisState, 
    history,
    isLoadingHistory,
    isLoadingMoreHistory,
    loadingReportId,
    historyLoadedCount,
    historyTotalCount,
    historyHasMore,
    historyError,
    saveStatus,
    saveMessage,
    startAnalysis,
    startCandidateAnalysis,
    startFollowUpAnalysis,
    resetAnalysis, 
    loadFromHistory, 
    deleteFromHistory, 
    clearHistory,
    refreshHistory,
    dismissSaveNotice,
    retryLastAnalysis,
    runtimeModelConfig,
    applyRuntimeModelConfig,
    reloadRuntimeModelConfig,
  };
};
