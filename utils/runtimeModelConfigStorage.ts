import { RuntimeModelConfig, SearchMode } from '../types.ts';
import { apiFetch } from './authenticatedFetch.ts';

export const RUNTIME_MODEL_CONFIG_STORAGE_KEY = 'intelligentStockAgentRuntimeModelConfigV8';

/** System-wide default: DeepSeek analysis + Doubao search, 18/18 questions, thinking off. */
export const DEFAULT_RUNTIME_MODEL_CONFIG: RuntimeModelConfig = {
  analysis: { provider: 'deepseek', model: 'deepseek-v4-pro' },
  search: { provider: 'doubao', model: 'deepseek-v4-pro' },
  searchMode: 'standard',
  questions: { focus: 18, candidate: 18 },
  qna: { thinkingEnabled: false },
};

export const STANDARD_MODE_CONFIG: RuntimeModelConfig = { ...DEFAULT_RUNTIME_MODEL_CONFIG, searchMode: 'standard' };

export const ADVANCED_MODE_CONFIG: RuntimeModelConfig = { ...DEFAULT_RUNTIME_MODEL_CONFIG, searchMode: 'advanced' };

/** Bump legacy persisted defaults when app defaults were raised (e.g. 10 → 18, 15 → 18). */
export const migrateLegacyQuestionCounts = (
  focus: number,
  candidate: number,
  targetFocus = DEFAULT_RUNTIME_MODEL_CONFIG.questions.focus,
  targetCandidate = DEFAULT_RUNTIME_MODEL_CONFIG.questions.candidate
): { focus: number; candidate: number; migrated: boolean } => {
  let nextFocus = focus;
  let nextCandidate = candidate;
  let migrated = false;

  if ((nextFocus === 10 || nextFocus === 15) && targetFocus > nextFocus) {
    nextFocus = targetFocus;
    migrated = true;
  }
  if ((nextCandidate === 10 || nextCandidate === 15) && targetCandidate > nextCandidate) {
    nextCandidate = targetCandidate;
    migrated = true;
  }

  return { focus: nextFocus, candidate: nextCandidate, migrated };
};

export const migrateRuntimeModelConfig = (
  config: RuntimeModelConfig
): { config: RuntimeModelConfig; migrated: boolean } => {
  const { focus, candidate, migrated: countsMigrated } = migrateLegacyQuestionCounts(
    config.questions.focus,
    config.questions.candidate
  );
  let migrated = countsMigrated;
  let next = config;

  if (countsMigrated) {
    next = { ...next, questions: { focus, candidate } };
  }

  if (!next.searchMode) {
    next = { ...next, searchMode: 'standard' };
    migrated = true;
  }

  return migrated ? { config: next, migrated: true } : { config: next, migrated: false };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeSearchMode = (value: unknown, fallback: SearchMode): SearchMode =>
  value === 'advanced' ? 'advanced' : value === 'standard' ? 'standard' : fallback;

export const normalizeRuntimeModelConfig = (
  raw: unknown,
  fallback: RuntimeModelConfig = DEFAULT_RUNTIME_MODEL_CONFIG
): RuntimeModelConfig => {
  const parsed = raw as Partial<RuntimeModelConfig> | null | undefined;
  const searchProvider =
    parsed?.search?.provider === 'vertex'
      ? 'vertex'
      : parsed?.search?.provider === 'doubao'
        ? 'doubao'
        : fallback.search.provider;

  return {
    analysis: {
      provider: parsed?.analysis?.provider === 'vertex' ? 'vertex' : 'deepseek',
      model:
        typeof parsed?.analysis?.model === 'string' && parsed.analysis.model.trim()
          ? parsed.analysis.model.trim()
          : fallback.analysis.model,
    },
    search: {
      provider: searchProvider,
      model:
        typeof parsed?.search?.model === 'string' && parsed.search.model.trim()
          ? parsed.search.model.trim()
          : fallback.search.model,
    },
    searchMode: normalizeSearchMode(parsed?.searchMode, fallback.searchMode),
    questions: {
      focus:
        typeof parsed?.questions?.focus === 'number' && Number.isFinite(parsed.questions.focus)
          ? Math.max(5, Math.floor(parsed.questions.focus))
          : fallback.questions.focus,
      candidate:
        typeof parsed?.questions?.candidate === 'number' && Number.isFinite(parsed.questions.candidate)
          ? Math.max(3, Math.floor(parsed.questions.candidate))
          : fallback.questions.candidate,
    },
    qna: {
      thinkingEnabled:
        typeof parsed?.qna?.thinkingEnabled === 'boolean'
          ? parsed.qna.thinkingEnabled
          : fallback.qna.thinkingEnabled,
    },
  };
};

export const loadStoredRuntimeModelConfig = (
  fallback: RuntimeModelConfig = DEFAULT_RUNTIME_MODEL_CONFIG
): RuntimeModelConfig | null => {
  if (typeof window === 'undefined') return null;
  let raw = localStorage.getItem(RUNTIME_MODEL_CONFIG_STORAGE_KEY);
  if (!raw) {
    raw = localStorage.getItem('intelligentStockAgentRuntimeModelConfigV7');
  }
  if (!raw) return null;
  try {
    const normalized = normalizeRuntimeModelConfig(JSON.parse(raw), fallback);
    const { config, migrated } = migrateRuntimeModelConfig(normalized);
    if (migrated) saveStoredRuntimeModelConfig(config);
    return config;
  } catch {
    return null;
  }
};

export const saveStoredRuntimeModelConfig = (config: RuntimeModelConfig): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RUNTIME_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config));
};

export const pushRuntimeModelConfigToBackend = async (
  config: RuntimeModelConfig,
  apiBaseUrl = ''
): Promise<RuntimeModelConfig> => {
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8_000);
      const response = await apiFetch(`${apiBaseUrl}/api/vertex-ai/model-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to sync model config (${response.status})`);
      }
      const data = await response.json();
      return normalizeRuntimeModelConfig(data, config);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(200 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to sync model config to backend');
};

export const configForSearchMode = (mode: SearchMode): RuntimeModelConfig =>
  mode === 'advanced' ? { ...ADVANCED_MODE_CONFIG } : { ...STANDARD_MODE_CONFIG };
