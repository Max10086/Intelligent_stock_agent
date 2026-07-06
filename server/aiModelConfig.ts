import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export type ModelProvider = 'vertex' | 'deepseek';
export type SearchProvider = 'vertex' | 'doubao';
export type SearchMode = 'standard' | 'advanced';

const toInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeProvider = (value: string | undefined, fallback: ModelProvider): ModelProvider => {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'vertex' || normalized === 'deepseek') {
    return normalized;
  }
  return fallback;
};

const normalizeSearchProvider = (value: string | undefined, fallback: SearchProvider): SearchProvider => {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'vertex' || normalized === 'doubao') {
    return normalized;
  }
  return fallback;
};

export const SEARCH_MODEL_PROVIDER: SearchProvider = normalizeSearchProvider(process.env.SEARCH_MODEL_PROVIDER, 'doubao');
export const SEARCH_MODEL =
  (process.env.SEARCH_MODEL && process.env.SEARCH_MODEL.trim()) ||
  (process.env.VERTEX_SEARCH_MODEL && process.env.VERTEX_SEARCH_MODEL.trim()) ||
  (process.env.DOUBAO_SEARCH_MODEL && process.env.DOUBAO_SEARCH_MODEL.trim()) ||
  (SEARCH_MODEL_PROVIDER === 'doubao' ? 'deepseek-v4-pro' : 'gemini-3-flash-preview');

// Non-search analysis model can be switched (e.g. deepseek-v4-pro).
export const ANALYSIS_MODEL_PROVIDER = normalizeProvider(process.env.ANALYSIS_MODEL_PROVIDER, 'deepseek');
export const ANALYSIS_MODEL =
  (process.env.ANALYSIS_MODEL && process.env.ANALYSIS_MODEL.trim()) ||
  (ANALYSIS_MODEL_PROVIDER === 'deepseek' ? 'deepseek-v4-pro' : SEARCH_MODEL);

// Question count controls.
export const FOCUS_QUESTION_COUNT = Math.max(5, toInt(process.env.FOCUS_QUESTION_COUNT, 18));
export const CANDIDATE_QUESTION_COUNT = Math.max(3, toInt(process.env.CANDIDATE_QUESTION_COUNT, 18));

/** Default for detailed Q&A synthesis thinking (override via runtime config UI). */
export const QNA_THINKING_ENABLED = process.env.QNA_THINKING_ENABLED === 'true';

export const DEFAULT_SEARCH_MODE: SearchMode =
  process.env.SEARCH_MODE === 'advanced' ? 'advanced' : 'standard';

// DeepSeek OpenAI-compatible endpoint config.
export const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
export const DEEPSEEK_BASE_URL =
  (process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_BASE_URL.trim()) ||
  'https://api.deepseek.com/v1/chat/completions';

// Doubao search config (OpenAI-compatible endpoint expected).
export const DOUBAO_SEARCH_API_KEY = (process.env.DOUBAO_SEARCH_API_KEY || '').trim();
export const DOUBAO_SEARCH_BASE_URL =
  (process.env.DOUBAO_SEARCH_BASE_URL && process.env.DOUBAO_SEARCH_BASE_URL.trim()) ||
  'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
export const DOUBAO_CUSTOM_API_KEY =
  (process.env.DOUBAO_CUSTOM_API_KEY && process.env.DOUBAO_CUSTOM_API_KEY.trim()) ||
  (process.env.DOUBAO_CUSTOM_APP_KEY && process.env.DOUBAO_CUSTOM_APP_KEY.trim()) ||
  '';
export const DOUBAO_CUSTOM_BASE_URL =
  (process.env.DOUBAO_CUSTOM_BASE_URL && process.env.DOUBAO_CUSTOM_BASE_URL.trim()) ||
  'https://open.feedcoopapi.com/search_api/web_search';
export const DOUBAO_CUSTOM_SEARCH_TYPE =
  (process.env.DOUBAO_CUSTOM_SEARCH_TYPE && process.env.DOUBAO_CUSTOM_SEARCH_TYPE.trim()) ||
  'web';
export const DOUBAO_CUSTOM_RESULT_COUNT = Math.max(1, Math.min(20, toInt(process.env.DOUBAO_CUSTOM_RESULT_COUNT, 10)));

// Optional pricing (USD per 1M tokens) for telemetry estimates.
export const SEARCH_INPUT_COST_PER_MILLION_USD = toFloat(
  process.env.SEARCH_INPUT_COST_PER_MILLION_USD,
  0
);
export const SEARCH_OUTPUT_COST_PER_MILLION_USD = toFloat(
  process.env.SEARCH_OUTPUT_COST_PER_MILLION_USD,
  0
);
export const ANALYSIS_INPUT_COST_PER_MILLION_USD = toFloat(
  process.env.ANALYSIS_INPUT_COST_PER_MILLION_USD,
  0
);
export const ANALYSIS_OUTPUT_COST_PER_MILLION_USD = toFloat(
  process.env.ANALYSIS_OUTPUT_COST_PER_MILLION_USD,
  0
);

type RuntimeOverride = {
  search?: { provider?: SearchProvider; model?: string };
  searchMode?: SearchMode;
  analysis?: { provider?: ModelProvider; model?: string };
  questions?: { focus?: number; candidate?: number };
  qna?: { thinkingEnabled?: boolean };
};

const RUNTIME_CONFIG_PATH =
  (process.env.RUNTIME_MODEL_CONFIG_PATH && process.env.RUNTIME_MODEL_CONFIG_PATH.trim()) ||
  path.join(process.cwd(), '.runtime-model-config.json');

const cleanModel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const cleanQuestionCount = (value: unknown, min: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.floor(value));
};

/** Bump legacy persisted defaults when env defaults were raised (e.g. 10 → 18, 15 → 18). */
const resolveQuestionCounts = (
  focus: number | undefined,
  candidate: number | undefined
): { focus: number; candidate: number } => {
  let resolvedFocus = focus ?? FOCUS_QUESTION_COUNT;
  let resolvedCandidate = candidate ?? CANDIDATE_QUESTION_COUNT;
  if (resolvedFocus === 10 && FOCUS_QUESTION_COUNT > 10) resolvedFocus = FOCUS_QUESTION_COUNT;
  if (resolvedFocus === 15 && FOCUS_QUESTION_COUNT > 15) resolvedFocus = FOCUS_QUESTION_COUNT;
  if (resolvedCandidate === 10 && CANDIDATE_QUESTION_COUNT > 10) {
    resolvedCandidate = CANDIDATE_QUESTION_COUNT;
  }
  if (resolvedCandidate === 15 && CANDIDATE_QUESTION_COUNT > 15) {
    resolvedCandidate = CANDIDATE_QUESTION_COUNT;
  }
  return {
    focus: Math.max(5, resolvedFocus),
    candidate: Math.max(3, resolvedCandidate),
  };
};

function loadPersistedRuntimeOverrides(): RuntimeOverride {
  try {
    if (!fs.existsSync(RUNTIME_CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
    const questions = resolveQuestionCounts(
      cleanQuestionCount(raw?.questions?.focus, 5),
      cleanQuestionCount(raw?.questions?.candidate, 3)
    );
    const loaded: RuntimeOverride = {
      search: {
        provider:
          raw?.search?.provider === 'vertex' || raw?.search?.provider === 'doubao'
            ? raw.search.provider
            : undefined,
        model: cleanModel(raw?.search?.model),
      },
      searchMode: raw?.searchMode === 'advanced' || raw?.searchMode === 'standard' ? raw.searchMode : undefined,
      analysis: {
        provider:
          raw?.analysis?.provider === 'vertex' || raw?.analysis?.provider === 'deepseek'
            ? raw.analysis.provider
            : undefined,
        model: cleanModel(raw?.analysis?.model),
      },
      questions,
      qna: {
        thinkingEnabled:
          typeof raw?.qna?.thinkingEnabled === 'boolean' ? raw.qna.thinkingEnabled : undefined,
      },
    };
    const migrated =
      raw?.questions?.focus === 10 ||
      raw?.questions?.candidate === 10 ||
      raw?.questions?.focus === 15 ||
      raw?.questions?.candidate === 15 ||
      questions.focus !== raw?.questions?.focus ||
      questions.candidate !== raw?.questions?.candidate;
    if (migrated) {
      persistRuntimeOverrides(loaded);
    }
    return loaded;
  } catch (error) {
    console.warn('[ModelConfig] Failed to load persisted runtime config:', error);
    return {};
  }
}

let runtimeOverrides: RuntimeOverride = loadPersistedRuntimeOverrides();

/** Cloud Run / server env vars pin defaults; they beat persisted .runtime-model-config.json. */
const envPinnedSearchProvider = process.env.SEARCH_MODEL_PROVIDER?.trim()
  ? normalizeSearchProvider(process.env.SEARCH_MODEL_PROVIDER, SEARCH_MODEL_PROVIDER)
  : undefined;
const envPinnedSearchModel = cleanModel(process.env.SEARCH_MODEL);
const envPinnedAnalysisProvider = process.env.ANALYSIS_MODEL_PROVIDER?.trim()
  ? normalizeProvider(process.env.ANALYSIS_MODEL_PROVIDER, ANALYSIS_MODEL_PROVIDER)
  : undefined;
const envPinnedAnalysisModel = cleanModel(process.env.ANALYSIS_MODEL);

export const getRuntimeModelConfig = () => ({
  search: {
    provider:
      envPinnedSearchProvider || runtimeOverrides.search?.provider || SEARCH_MODEL_PROVIDER,
    model: envPinnedSearchModel || runtimeOverrides.search?.model || SEARCH_MODEL,
  },
  searchMode: runtimeOverrides.searchMode || DEFAULT_SEARCH_MODE,
  analysis: {
    provider:
      envPinnedAnalysisProvider || runtimeOverrides.analysis?.provider || ANALYSIS_MODEL_PROVIDER,
    model: envPinnedAnalysisModel || runtimeOverrides.analysis?.model || ANALYSIS_MODEL,
  },
  questions: {
    focus: runtimeOverrides.questions?.focus || FOCUS_QUESTION_COUNT,
    candidate: runtimeOverrides.questions?.candidate || CANDIDATE_QUESTION_COUNT,
  },
  qna: {
    thinkingEnabled:
      typeof runtimeOverrides.qna?.thinkingEnabled === 'boolean'
        ? runtimeOverrides.qna.thinkingEnabled
        : QNA_THINKING_ENABLED,
  },
});

function persistRuntimeOverrides(overrides: RuntimeOverride) {
  try {
    fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(getRuntimeModelConfigFromOverrides(overrides), null, 2));
  } catch (error) {
    console.warn('[ModelConfig] Failed to persist runtime config:', error);
  }
}

function getRuntimeModelConfigFromOverrides(overrides: RuntimeOverride) {
  return {
    search: {
      provider: overrides.search?.provider || SEARCH_MODEL_PROVIDER,
      model: overrides.search?.model || SEARCH_MODEL,
    },
    searchMode: overrides.searchMode || DEFAULT_SEARCH_MODE,
    analysis: {
      provider: overrides.analysis?.provider || ANALYSIS_MODEL_PROVIDER,
      model: overrides.analysis?.model || ANALYSIS_MODEL,
    },
    questions: {
      focus: overrides.questions?.focus || FOCUS_QUESTION_COUNT,
      candidate: overrides.questions?.candidate || CANDIDATE_QUESTION_COUNT,
    },
    qna: {
      thinkingEnabled:
        typeof overrides.qna?.thinkingEnabled === 'boolean'
          ? overrides.qna.thinkingEnabled
          : QNA_THINKING_ENABLED,
    },
  };
}

export const setRuntimeModelConfig = (override: RuntimeOverride) => {
  runtimeOverrides = {
    search: {
      provider:
        override.search?.provider === 'vertex' || override.search?.provider === 'doubao'
          ? override.search.provider
          : undefined,
      model: cleanModel(override.search?.model),
    },
    searchMode:
      override.searchMode === 'advanced' || override.searchMode === 'standard'
        ? override.searchMode
        : undefined,
    analysis: {
      provider:
        override.analysis?.provider === 'vertex' || override.analysis?.provider === 'deepseek'
          ? override.analysis.provider
          : undefined,
      model: cleanModel(override.analysis?.model),
    },
    questions: resolveQuestionCounts(
      cleanQuestionCount(override.questions?.focus, 5),
      cleanQuestionCount(override.questions?.candidate, 3)
    ),
    qna: {
      thinkingEnabled:
        typeof override.qna?.thinkingEnabled === 'boolean' ? override.qna.thinkingEnabled : undefined,
    },
  };
  persistRuntimeOverrides(runtimeOverrides);
  return getRuntimeModelConfig();
};

