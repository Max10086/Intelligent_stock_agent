
import { useState, useCallback, useEffect, useRef } from 'react';
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
import { isUnusableSearchAnswer } from '../utils/qnaAnswerQuality.ts';
import {
  buildFindCompaniesByConceptPrompt,
  buildFindCompetitorsPrompt,
  parseCompetitorsResponse,
  parseConceptDiscoveryResponse,
} from '../utils/companyDiscovery.ts';
import {
  findIncompleteCompanies,
  hasUsableFinalConclusion,
  isCompanyAnalysisComplete,
} from '../utils/analysisComplete.ts';
import { buildGenerateQuestionsPrompt } from '../utils/questionGenerationPrompt.ts';
import { generateQuestionsInBatches } from '../utils/questionGenerationBatches.ts';
import { buildRecencyGuidance } from '../utils/recencyGuidance.ts';
import { pickLanguageValidQuestions } from '../utils/questionLanguage.ts';
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
  pushRuntimeModelConfigToBackend,
  saveStoredRuntimeModelConfig,
} from '../utils/runtimeModelConfigStorage.ts';

const ACTIVE_ANALYSIS_KEY = 'intelligentStockAgentActiveState';
const HISTORY_KEY = 'intelligentStockAgentHistory';
const PENDING_SAVE_KEY = 'intelligentStockAgentPendingSaves';

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';
const HISTORY_FETCH_TIMEOUT_MS = 45000;

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

export const useStockAgent = () => {
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
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [runtimeModelConfig, setRuntimeModelConfig] = useState<RuntimeModelConfig>(DEFAULT_RUNTIME_MODEL_CONFIG);
  const analysisStateRef = useRef<AnalysisState>(analysisState);
  const telemetryRef = useRef<LlmTelemetryEntry[]>([]);
  const historyFetchRef = useRef<Promise<AnalysisState[]> | null>(null);

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

  const fetchHistoryFromServer = useCallback(async (): Promise<AnalysisState[]> => {
    if (historyFetchRef.current) {
      return historyFetchRef.current;
    }

    const fetchPromise = (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), HISTORY_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`${API_BASE_URL}/api/history`, {
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
        return serverHistory.sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeB - timeA;
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    historyFetchRef.current = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (historyFetchRef.current === fetchPromise) {
        historyFetchRef.current = null;
      }
    }
  }, []);

  const fetchReportById = useCallback(async (id: string): Promise<AnalysisState> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), HISTORY_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/${id}`, {
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
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  // Fetch history from server on mount (100% server-based)
  useEffect(() => {
    const fetchServerHistory = async () => {
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const sortedHistory = await fetchHistoryFromServer();
        setHistory(sortedHistory);
      } catch (error) {
        console.error('Could not fetch server history:', error);
        setHistory([]);
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'History request timed out. The backend may be stuck — try restarting npm run dev.'
            : error instanceof Error
              ? error.message
              : 'Failed to fetch history';
        setHistoryError(message);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    void fetchServerHistory();
  }, [fetchHistoryFromServer]);

  const reloadRuntimeModelConfig = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/vertex-ai/model-config`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.analysis?.provider && data?.analysis?.model && data?.search?.model) {
        const nextConfig: RuntimeModelConfig = {
          analysis: {
            provider: data.analysis.provider,
            model: data.analysis.model,
          },
          search: {
            provider: normalizeSearchProvider(data.search.provider),
            model: data.search.model,
          },
          questions: {
            focus: Number(data?.questions?.focus) || DEFAULT_RUNTIME_MODEL_CONFIG.questions.focus,
            candidate: Number(data?.questions?.candidate) || DEFAULT_RUNTIME_MODEL_CONFIG.questions.candidate,
          },
          qna: {
            thinkingEnabled:
              typeof data?.qna?.thinkingEnabled === 'boolean'
                ? data.qna.thinkingEnabled
                : DEFAULT_RUNTIME_MODEL_CONFIG.qna.thinkingEnabled,
          },
        };
        setRuntimeModelConfig(nextConfig);
        return nextConfig;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const syncRuntimeModelConfigFromUserSettings = useCallback(async (): Promise<RuntimeModelConfig> => {
    const fromServer = await reloadRuntimeModelConfig();
    if (fromServer) {
      setRuntimeModelConfig(fromServer);
      saveStoredRuntimeModelConfig(fromServer);
      return fromServer;
    }

    const stored = loadStoredRuntimeModelConfig(DEFAULT_RUNTIME_MODEL_CONFIG);
    if (stored) {
      setRuntimeModelConfig(stored);
      try {
        await pushRuntimeModelConfigToBackend(stored, API_BASE_URL);
      } catch (error) {
        console.warn('Failed to sync stored model settings to backend:', error);
      }
      return stored;
    }

    setRuntimeModelConfig(DEFAULT_RUNTIME_MODEL_CONFIG);
    return DEFAULT_RUNTIME_MODEL_CONFIG;
  }, [reloadRuntimeModelConfig]);

  useEffect(() => {
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
  const refreshHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const sortedHistory = await fetchHistoryFromServer();
      setHistory(sortedHistory);
    } catch (error) {
      console.error('Could not refresh history:', error);
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'History request timed out. The backend may be stuck — try restarting npm run dev.'
          : error instanceof Error
            ? error.message
            : 'Failed to fetch history';
      setHistoryError(message);
    } finally {
      setIsLoadingHistory(false);
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
        const response = await fetch(`${API_BASE_URL}/api/history`, {
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
    setAnalysisState(prev => {
      const next = updater(prev);
      analysisStateRef.current = next;
      return next;
    });
  };

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
      const response = await fetch(`${API_BASE_URL}/api/search-ticker?query=${encodeURIComponent(query)}`);
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

  const findCompetitors = async (focusCompany: Pick<CompanyProfile, 'name' | 'ticker'>, lang: Language): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
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

    const callDiscovery = async (strict: boolean) => {
      const startedAt = Date.now();
      const response = await ai.models.generateContent({
        provider: runtimeModelConfig.analysis.provider,
        model: runtimeModelConfig.analysis.model,
        step: 'company_discovery',
        contents: {
          role: 'user',
          parts: [{ text: buildFindCompetitorsPrompt(focusCompany, outputLanguage, strict) }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      appendTelemetry('company_discovery', startedAt, response);
      return response.text || '';
    };

    let competitors = parseCompetitorsResponse(await callDiscovery(false)).filter(
      c => c.ticker.toUpperCase() !== focusCompany.ticker.toUpperCase()
    );
    if (competitors.length === 0) {
      competitors = parseCompetitorsResponse(await callDiscovery(true)).filter(
        c => c.ticker.toUpperCase() !== focusCompany.ticker.toUpperCase()
      );
    }
    return competitors.slice(0, 2);
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
      return companies.slice(0, 3);
  };

  const generateQuestions = async (companyName: string, lang: Language, questionCount: number): Promise<string[]> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildRecencyGuidance(now, lang);

    const callBatch = async (
      batchSize: number,
      batchIndex: number,
      batchTotal: number,
      priorQuestionCount: number,
      strictLanguageRetry: boolean
    ) => {
      const prompt = buildGenerateQuestionsPrompt(
        companyName,
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
                ? `生成研究问题 (${batchIndex + 1}/${batchTotal})...`
                : `Generating research questions (${batchIndex + 1}/${batchTotal})...`,
          });
        },
      }
    );
  };

  const generateFollowUpQuestions = async (
    companyName: string,
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
        companyName,
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

  const answerQuestion = async (question: string, companyName: string, lang: Language): Promise<QnAResult> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const prompt =
      lang === 'cn'
        ? `作为金融分析师，请用简体中文回答关于「${companyName}」的以下问题：「${question}」
${buildRecencyGuidance(now, lang)}
回答要求：
- 优先使用最新可得数据，旧数据仅作对比参考。
- 若无法获取最新披露/期间数据，须明确说明限制。
- 关键事实须标注期间（如 YYYY-Qx、YYYY 年报、YYYY-MM）。
- 引用信息来源。`
        : `As a financial analyst, answer this question about "${companyName}" in ${outputLanguage}: "${question}".
${buildRecencyGuidance(now, lang)}
Answer requirements:
- Use freshest available data first; older data is secondary context only.
- If the latest filing/period is unavailable, clearly disclose that limitation.
- For key facts, include period labels (e.g. YYYY-Qx, YYYY annual report, YYYY-MM).
- Cite sources.`;
    
    const startedAt = Date.now();
    const response = await ai.models.generateContent({
      provider: runtimeModelConfig.search.provider,
      model: runtimeModelConfig.search.model,
      step: 'answer_question',
      requireGoogleSearch: true,
      contents: { role: 'user', parts: [{ text: prompt }] },
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    appendTelemetry('answer_question', startedAt, response);

    const sources: GroundingSource[] = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter(Boolean) ?? [];

    const answer = response.text || '';
    if (isUnusableSearchAnswer(answer)) {
      throw new Error(
        lang === 'cn'
          ? '本题搜索未返回可用证据，将自动重试。'
          : 'Search returned no usable evidence for this question; retrying.'
      );
    }

    return { question, answer, sources };
  };

  const answerFollowUpQuestion = async (
    question: string,
    companyName: string,
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<QnAResult> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const now = new Date();
    const recencyGuidance = buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, now, lang);
    const prompt = buildFollowUpAnswerPrompt(
      question,
      companyName,
      outputLanguage,
      recencyGuidance,
      followUpContext.baseline
    );

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

    const sources: GroundingSource[] = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter(Boolean) ?? [];

    const answer = response.text || '';
    if (isUnusableSearchAnswer(answer)) {
      throw new Error(
        lang === 'cn'
          ? '本题搜索未返回可用证据，将自动重试。'
          : 'Search returned no usable evidence for this question; retrying.'
      );
    }

    return { question, answer, sources };
  };

  const synthesizeConclusion = async (companyName: string, qna: QnAResult[], lang: Language): Promise<InvestmentConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
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
      companyName,
      outputLanguage,
      recencyGuidance: buildRecencyGuidance(new Date(), lang),
      qna: qnaPayload,
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
    companyName: string,
    qna: QnAResult[],
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<InvestmentConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
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
      companyName,
      outputLanguage,
      recencyGuidance,
      qna: qnaPayload,
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
    companyName: string,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language
  ): Promise<FinalConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    
    const finalConclusionSchema = {
        type: Type.OBJECT,
        properties: {
            overall_conclusion: { 
                type: Type.STRING,
                description: `Rating plus 3-5 sentence executive summary for ${companyName}.`
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
        companyName,
        outputLanguage,
        buildRecencyGuidance(new Date(), lang),
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer, sources: item.sources }))
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
      throw new Error(`Failed to generate a usable final investment conclusion for ${companyName}.`);
    }
    return finalConclusion;
  };

  const generateFollowUpFinalConclusion = async (
    companyName: string,
    qna: QnAResult[],
    conclusion: InvestmentConclusion,
    lang: Language,
    followUpContext: FollowUpRunContext
  ): Promise<FinalConclusion> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const recencyGuidance = buildFollowUpRecencyGuidance(followUpContext.parentTimestamp, new Date(), lang);

    const buildPrompt = (strict: boolean) => {
      const base = buildFollowUpFinalConclusionPrompt(
        companyName,
        outputLanguage,
        recencyGuidance,
        followUpContext.baseline,
        conclusion,
        qna.map(item => ({ question: item.question, answer: item.answer }))
      );
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
      throw new Error(`Failed to generate a usable follow-up conclusion for ${companyName}.`);
    }
    return finalConclusion;
  };

  const generateCompanyQuickTake = async (
    company: CompanyProfile,
    lang: Language
  ): Promise<string> => {
    const outputLanguage = lang === 'cn' ? 'Simplified Chinese' : 'English';
    const prompt = `You are writing a sharp "at-a-glance" company brief in ${outputLanguage}.

Target company:
- Name: ${company.name}
- Ticker/Exchange: ${company.ticker} (${company.exchange})
- Market cap: ${company.marketCap || 'N/A'}
- Float market cap: ${company.floatMarketCap || 'N/A'}

Reference writing style (must emulate this level of concreteness and directness):
"Rocket Lab (RKLB) is the second-largest commercial space company in the U.S. after SpaceX, and a key player in high-frequency small-satellite launches. Its core model is an end-to-end space stack: it not only earns launch revenue, but also manufactures satellites and mission-critical components, offering integrated build+launch services to monetize across the full value chain."

Hard requirements:
1) Output EXACTLY 2 sentences.
2) Sentence 1: state company identity + relative position/role in its market + scale signal.
3) Sentence 2: explain the monetization model concretely (how it makes money, key products/services, value-chain position).
4) Use concrete industry wording; no generic filler.
5) Forbidden vague phrases (or their equivalents): "core product and service model", "certain differentiation", "comprehensive conclusion", "etc.".
6) No markdown, no bullet points, no disclaimer.`;

    const startedAt = Date.now();
    const response = await ai.models.generateContent({
      provider: runtimeModelConfig.analysis.provider,
      model: runtimeModelConfig.analysis.model,
      step: 'quick_take',
      contents: { role: 'user', parts: [{ text: prompt }] },
    });
    appendTelemetry('quick_take', startedAt, response);

    return (response.text || '').replace(/\s+/g, ' ').trim();
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
        questions = isFollowUp && followUpContext
          ? await generateFollowUpQuestions(company.name, lang, questionCount, followUpContext)
          : await generateQuestions(company.name, lang, questionCount);
        updateCompanyState(companyId, { questions });
        await delay(300);
      }

      const totalQuestions = questions.length || questionCount;

      updateCompanyState(companyId, { status: 'answering_questions' });
      const { qnaByQuestion, pendingIndices } = indexAnsweredQuestions(questions, existingQna);
      let completedCount = countAnsweredQuestions(questions, qnaByQuestion);

      if (completedCount > 0) {
        updateCompanyState(companyId, { qna: orderQnaByQuestions(questions, qnaByQuestion) });
      }

      const reportQnaProgress = (completed: number) => {
        const safeCompleted = Math.min(completed, totalQuestions);
        updateState({
          currentStage: (lang === 'cn'
            ? `${company.name}：已完成 ${safeCompleted}/${totalQuestions} 题...`
            : `${company.name}: Completed ${safeCompleted}/${totalQuestions} questions...`),
          currentProgress: 20 + Math.floor((safeCompleted / totalQuestions) * 50),
        });
      };

      reportQnaProgress(completedCount);

      if (pendingIndices.length > 0) {
        const pendingTasks = pendingIndices.map(index => ({
          index,
          item: questions[index],
        }));

        await runParallelIndexedTasks<string, QnAResult>(
          pendingTasks,
          async task =>
            isFollowUp && followUpContext
              ? answerFollowUpQuestion(task.item, company.name, lang, followUpContext)
              : answerQuestion(task.item, company.name, lang),
          {
            concurrency: QNA_CONCURRENCY,
            onTaskComplete: async (result, task) => {
              const questionKey = questions[task.index];
              qnaByQuestion.set(questionKey, { ...result, question: questionKey });
              completedCount = countAnsweredQuestions(questions, qnaByQuestion);
              updateCompanyState(companyId, { qna: orderQnaByQuestions(questions, qnaByQuestion) });
              reportQnaProgress(completedCount);
            },
          }
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
        conclusion = isFollowUp && followUpContext
          ? await synthesizeFollowUpConclusion(company.name, qnaResults, lang, followUpContext)
          : await synthesizeConclusion(company.name, qnaResults, lang);
        updateCompanyState(companyId, { conclusion });
        await delay(200);
      } else {
        updateCompanyState(companyId, { conclusion });
      }

      let finalConclusion = existingFinalConclusion;
      if (!finalConclusion) {
        updateState({ currentStage: uiText.generatingFinalConclusion, currentProgress: 90 });
        finalConclusion = isFollowUp && followUpContext
          ? await generateFollowUpFinalConclusion(company.name, qnaResults, conclusion, lang, followUpContext)
          : await generateFinalConclusion(company.name, qnaResults, conclusion, lang);
      }
      updateCompanyState(companyId, { finalConclusion, status: 'complete' });

      updateState({
        currentStage:
          lang === 'cn'
            ? `${company.name}：分析完成`
            : `${company.name}: analysis complete`,
        currentProgress: 100,
      });

    } catch (e) {
      console.error(`Error analyzing ${company.name}:`, e);
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      updateCompanyState(companyId, { status: 'error', error: errorMessage });
      throw e;
    }
  };

  const saveCompletedState = useCallback(async (completedState: AnalysisState, lang: Language) => {
    // Save to server database immediately after reaching 100%
    setSaveStatus('saving');
    setSaveMessage(getUIText(lang).savingReport);
    try {
      const response = await fetch(`${API_BASE_URL}/api/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          result: completedState,
          query: completedState.query,
          language: completedState.language,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save report (${response.status})`);
      }

      const pending = loadPendingSaves().filter(item => item?.result?.id !== completedState.id);
      savePendingSaves(pending);
      await refreshHistory();
      setSaveStatus('success');
      setSaveMessage(getUIText(lang).saveSuccess);
    } catch (error) {
      console.error('Error saving report to server:', error);
      const message = error instanceof Error ? error.message : 'Failed to save report';
      enqueuePendingSave({
        result: completedState,
        query: completedState.query,
        language: completedState.language,
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

    applyAnalysisStateUpdate(prev => {
      const completedState: AnalysisState = {
        ...prev,
        status: 'complete',
        error: null,
        currentStage: getUIText(lang).analysisComplete,
        currentProgress: 100,
        llmTelemetry: telemetryRef.current,
      };
      return completedState;
    });

    await saveCompletedState(analysisStateRef.current, lang);
  }, [saveCompletedState]);

  const startAnalysis = useCallback(async (query: string, lang: Language) => {
    const id = Date.now().toString();
    setSaveStatus('idle');
    setSaveMessage('');
    telemetryRef.current = [];
    await syncRuntimeModelConfigFromUserSettings();
    setAnalysisState({ ...createInitialState(), id, timestamp: new Date().toISOString(), status: 'finding_companies', query, language: lang, currentStage: getUIText(lang).findingCompanies, currentProgress: 5 });
    
    try {
        let companyProfiles: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

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
                competitors = conceptCandidates
                  .filter(c => c.ticker.toUpperCase() !== exactMatch.ticker.toUpperCase())
                  .slice(0, 2);
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

        const validCompanyProfiles = companyProfiles.filter(isValidCompanyProfile);

        if (validCompanyProfiles.length === 0) {
            throw new Error("Could not identify any companies for the given query.");
        }
      
        updateState({ currentStage: 'Fetching financial data...', currentProgress: 15 });

        const enrichedProfiles = await Promise.all(
            validCompanyProfiles.map(p => getFinancialData(p))
        );

        const focusProfile = enrichedProfiles[0];
        const candidateProfiles = enrichedProfiles.slice(1);
        const companyQuickTakes = await Promise.all(
          enrichedProfiles.map(profile => generateCompanyQuickTake(profile, lang))
        );

        const focusAnalysis: CompanyAnalysis = { id: focusProfile.ticker, profile: focusProfile, quickTake: companyQuickTakes[0] || null, status: 'pending', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] };
        const candidateAnalyses: CompanyAnalysis[] = candidateProfiles.map((p, idx) => ({ id: p.ticker, profile: p, quickTake: companyQuickTakes[idx + 1] || null, status: 'pending', questions: [], qna: [], conclusion: null, finalConclusion: null, followUpQuestions: [] }));

        updateState({
            status: 'analyzing',
            focusCompany: focusAnalysis,
            candidateCompanies: candidateAnalyses,
            currentStage: getUIText(lang).analyzingCompany.replace('{companyName}', focusProfile.name),
        });

        await runAnalysisForCompany(focusAnalysis.id, focusProfile, lang, runtimeModelConfig.questions.focus);
        if (!isCompanyAnalysisComplete(analysisStateRef.current.focusCompany)) {
          throw new Error(
            lang === 'cn'
              ? `${focusProfile.name} 的分析结果未能写入状态，请重试。`
              : `Failed to persist analysis results for ${focusProfile.name}. Please retry.`
          );
        }
        await delay(2000);

        for (const company of candidateAnalyses) {
            updateState({ currentStage: getUIText(lang).analyzingCompany.replace('{companyName}', company.profile.name) });
            await runAnalysisForCompany(company.id, company.profile, lang, runtimeModelConfig.questions.candidate);
            if (!isCompanyAnalysisComplete(analysisStateRef.current.candidateCompanies.find(c => c.id === company.id))) {
              throw new Error(
                lang === 'cn'
                  ? `${company.profile.name} 的分析结果未能写入状态，请重试。`
                  : `Failed to persist analysis results for ${company.profile.name}. Please retry.`
              );
            }
            await delay(2000);
        }

        await finalizeAnalysisAsComplete(lang);

    } catch (e) {
        console.error("Analysis failed:", e);
        const errorMessage = e instanceof Error ? e.message : 'Failed to complete analysis.';
        updateState({ status: 'error', error: errorMessage, currentStage: getUIText(lang).errorTitle });
    }
  }, [runtimeModelConfig, searchTickerViaServer, finalizeAnalysisAsComplete, syncRuntimeModelConfigFromUserSettings]);

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

  const loadFromHistory = useCallback(async (id: string) => {
    const cached = history.find(item => item.id === id);
    const hasFullQna =
      cached &&
      [cached.focusCompany, ...(cached.candidateCompanies || [])].some(
        company => (company?.qna?.length || 0) > 0
      );

    try {
      const report = hasFullQna && cached ? cached : await fetchReportById(id);
      setAnalysisState(report);
      setHistory(prev => prev.map(item => (item.id === id ? report : item)));
      setHistoryError(null);
    } catch (error) {
      console.error('Error loading report from history:', error);
      if (cached) {
        setAnalysisState(cached);
        return;
      }
      throw error;
    }
  }, [history, fetchReportById]);

  const deleteFromHistory = useCallback(async (id: string) => {
    // Delete from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/history/${id}`, {
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
      const response = await fetch(`${API_BASE_URL}/api/history`, {
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
    historyError,
    saveStatus,
    saveMessage,
    startAnalysis,
    startFollowUpAnalysis,
    resetAnalysis, 
    loadFromHistory, 
    deleteFromHistory, 
    clearHistory,
    refreshHistory,
    dismissSaveNotice,
    retryLastAnalysis,
    runtimeModelConfig,
    reloadRuntimeModelConfig,
  };
};
