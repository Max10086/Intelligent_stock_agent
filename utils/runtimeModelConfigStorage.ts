import { RuntimeModelConfig, SearchProvider } from '../types.ts';

export const RUNTIME_MODEL_CONFIG_STORAGE_KEY = 'intelligentStockAgentRuntimeModelConfigV6';

export const DEFAULT_RUNTIME_MODEL_CONFIG: RuntimeModelConfig = {
  analysis: { provider: 'deepseek', model: 'deepseek-v4-pro' },
  search: { provider: 'doubao', model: 'deepseek-v4-pro' },
  questions: { focus: 15, candidate: 15 },
  qna: { thinkingEnabled: false },
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const normalizeRuntimeModelConfig = (
  raw: unknown,
  fallback: RuntimeModelConfig = DEFAULT_RUNTIME_MODEL_CONFIG
): RuntimeModelConfig => {
  const parsed = raw as Partial<RuntimeModelConfig> | null | undefined;
  const searchProvider: SearchProvider =
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
  const raw = localStorage.getItem(RUNTIME_MODEL_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeRuntimeModelConfig(JSON.parse(raw), fallback);
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
): Promise<void> => {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/vertex-ai/model-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to sync model config (${response.status})`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(300 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to sync model config to backend');
};
