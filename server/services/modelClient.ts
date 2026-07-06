import { GoogleGenAI } from '@google/genai';
import {
  ANALYSIS_INPUT_COST_PER_MILLION_USD,
  ANALYSIS_OUTPUT_COST_PER_MILLION_USD,
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  DOUBAO_CUSTOM_API_KEY,
  DOUBAO_CUSTOM_BASE_URL,
  DOUBAO_CUSTOM_RESULT_COUNT,
  DOUBAO_CUSTOM_SEARCH_TYPE,
  DOUBAO_SEARCH_API_KEY,
  DOUBAO_SEARCH_BASE_URL,
  getRuntimeModelConfig,
  ModelProvider,
  SEARCH_INPUT_COST_PER_MILLION_USD,
  SEARCH_OUTPUT_COST_PER_MILLION_USD,
} from '../aiModelConfig.js';
import { extractBalancedJsonObject, extractJsonObjectText, tryParseModelJson } from '../../utils/modelJson.js';
import { QUESTION_GENERATION_BATCH_TIMEOUT_MS } from '../../utils/questionGenerationBatches.js';
import { ANSWER_QUESTION_TIMEOUT_MS } from '../../utils/parallelTasks.js';
import { AsyncSemaphore } from '../../utils/asyncSemaphore.js';

export type ModelCallStep =
  | 'company_discovery'
  | 'question_generation'
  | 'follow_up_question_generation'
  | 'answer_question'
  | 'follow_up_answer_question'
  | 'doubao_search'
  | 'google_search'
  | 'answer_question_synthesis'
  | 'synthesize_conclusion'
  | 'synthesize_conclusion_section'
  | 'synthesize_conclusion_integrate'
  | 'follow_up_synthesize_conclusion_section'
  | 'follow_up_synthesize_conclusion_integrate'
  | 'final_conclusion'
  | 'follow_up_final_conclusion'
  | 'quick_take'
  | 'market_hot_topics'
  | 'cross_company_compare'
  | 'cross_company_compare_follow_up'
  | 'custom';

export interface UsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface LlmCallTelemetry {
  step: ModelCallStep;
  provider: ModelProvider | 'doubao';
  model: string;
  startedAt: string;
  durationMs: number;
  usage: UsageMetrics;
}

export interface ModelResponse {
  text: string;
  candidates?: any[];
  groundingMetadata?: any;
  usage?: UsageMetrics;
  provider: ModelProvider | 'doubao';
  model: string;
}

interface GenerateParams {
  step: ModelCallStep;
  contents: any;
  config?: any;
  provider?: ModelProvider | 'doubao';
  model?: string;
  requireGoogleSearch?: boolean;
}

const RETRYABLE_ERROR_PATTERN =
  /(fetch failed|sending request|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|503|502|500|429|700429|frequency exceeded|rate limit|terminated|UND_ERR_SOCKET|other side closed|Doubao search returned 0 results)/i;

/** Doubao search in-flight cap. Console QPS (e.g. 5) is per-second; default 4 leaves headroom for retries. Override via DOUBAO_SEARCH_CONCURRENCY. */
const DOUBAO_SEARCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.DOUBAO_SEARCH_CONCURRENCY || '4')
);
const DOUBAO_SEARCH_MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type DeepSeekReasoningEffort = 'medium' | 'high' | 'max';

/** Steps that benefit from deepest reasoning (final verdict). */
const DEEPSEEK_MAX_EFFORT_STEPS = new Set<ModelCallStep>([
  'final_conclusion',
  'follow_up_final_conclusion',
]);

/** Structured JSON steps — thinking off for speed. */
const DEEPSEEK_ALWAYS_NO_THINKING_STEPS = new Set<ModelCallStep>([
  'question_generation',
  'follow_up_question_generation',
  'synthesize_conclusion_section',
  'follow_up_synthesize_conclusion_section',
  'cross_company_compare',
  'cross_company_compare_follow_up',
  'market_hot_topics',
]);

/** Needs factual recall + structured JSON — medium thinking. */
const DEEPSEEK_MEDIUM_EFFORT_STEPS = new Set<ModelCallStep>([
  'company_discovery',
  'quick_take',
]);

/** Controlled via runtime config (Advanced Model Settings → Q&A thinking). */
const QNA_SYNTHESIS_STEP: ModelCallStep = 'answer_question_synthesis';

const isQnaSynthesisThinkingEnabled = (): boolean => getRuntimeModelConfig().qna.thinkingEnabled;

const shouldUseDeepSeekThinking = (step: ModelCallStep): boolean => {
  if (DEEPSEEK_ALWAYS_NO_THINKING_STEPS.has(step)) {
    return false;
  }
  if (step === QNA_SYNTHESIS_STEP) {
    return isQnaSynthesisThinkingEnabled();
  }
  return true;
};

const getDeepSeekReasoningEffort = (step: ModelCallStep): DeepSeekReasoningEffort => {
  if (DEEPSEEK_MAX_EFFORT_STEPS.has(step)) return 'max';
  if (DEEPSEEK_MEDIUM_EFFORT_STEPS.has(step)) return 'medium';
  return 'high';
};

const formatRetryableErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeMessage =
    cause instanceof Error ? cause.message : cause != null ? String(cause) : '';
  return `${error.message} ${causeMessage}`.trim();
};

const getDeepSeekMaxAttempts = (step: ModelCallStep): number =>
  step === 'synthesize_conclusion' ||
  step === 'synthesize_conclusion_section' ||
  step === 'follow_up_synthesize_conclusion_section' ||
  step === 'final_conclusion' ||
  step === 'follow_up_final_conclusion'
    ? 5
    : 3;

const getDeepSeekTimeoutMs = (step: ModelCallStep): number => {
  if (step === 'question_generation' || step === 'follow_up_question_generation') {
    return QUESTION_GENERATION_BATCH_TIMEOUT_MS;
  }
  if (step === 'answer_question_synthesis') {
    return ANSWER_QUESTION_TIMEOUT_MS;
  }
  if (step === 'quick_take') return 90_000;
  if (
    step === 'synthesize_conclusion_section' ||
    step === 'follow_up_synthesize_conclusion_section' ||
    step === 'final_conclusion' ||
    step === 'follow_up_final_conclusion'
  ) {
    return 360_000;
  }
  return 180_000;
};

const getDeepSeekRetryDelayMs = (attempt: number, message: string): number => {
  const isSocketDrop = /terminated|UND_ERR_SOCKET|other side closed|socket hang up|ECONNRESET/i.test(
    message
  );
  if (isSocketDrop) {
    return Math.min(30_000, 2_000 * 2 ** (attempt - 1));
  }
  return 500 * attempt;
};

const resolveDeepSeekResponseText = (
  message: any,
  wantsJson: boolean
): { text: string; recoveredFromReasoning: boolean } => {
  let text = (message?.content || '').trim();
  let recoveredFromReasoning = false;

  if (wantsJson && text) {
    text = extractBalancedJsonObject(text) || extractJsonObjectText(text) || text;
    if (!tryParseModelJson(text)) {
      text = '';
    }
  }

  if (wantsJson && !text && message?.reasoning_content) {
    const fromReasoning =
      extractBalancedJsonObject(message.reasoning_content) ||
      extractJsonObjectText(message.reasoning_content);
    if (fromReasoning && tryParseModelJson(fromReasoning)) {
      text = fromReasoning;
      recoveredFromReasoning = true;
    }
  }

  return { text, recoveredFromReasoning };
};

const buildDeepSeekPayload = (params: GenerateParams, model: string, prompt: string) => {
  const useThinking = shouldUseDeepSeekThinking(params.step);
  let finalPrompt = prompt;
  if (params.config?.responseMimeType === 'application/json' && params.config?.responseSchema) {
    finalPrompt += `\n\nYour JSON response MUST conform to this schema (required keys and nested fields):\n${JSON.stringify(params.config.responseSchema)}`;
  }
  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: finalPrompt }],
  };
  if (useThinking) {
    // https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    payload.reasoning_effort = getDeepSeekReasoningEffort(params.step);
    payload.thinking = { type: 'enabled' };
  } else {
    payload.thinking = { type: 'disabled' };
  }
  if (params.config?.responseMimeType === 'application/json') {
    payload.response_format = { type: 'json_object' };
  }
  return payload;
};

interface DoubaoQnaContext {
  companyName: string;
  question: string;
  searchQuery: string;
}

const extractDoubaoQnaContext = (prompt: string): DoubaoQnaContext => {
  const qnaMatch = prompt.match(/answer this question about\s+"([^"]+)"\s+in\s+[^:]+:\s+"([^"]+)"/i);
  if (qnaMatch) {
    const companyName = qnaMatch[1].trim();
    const question = qnaMatch[2].trim();
    const searchQuery = `${companyName} ${question}`.replace(/\s+/g, ' ').trim().slice(0, 100);
    return { companyName, question, searchQuery };
  }

  const quotedMatches = [...prompt.matchAll(/"([^"]+)"/g)].map(match => match[1].trim()).filter(Boolean);
  const companyName = quotedMatches[0] || '';
  const question = quotedMatches[1] || quotedMatches[0] || prompt.replace(/\s+/g, ' ').trim().slice(0, 200);
  const searchQuery = `${companyName} ${question}`.replace(/\s+/g, ' ').trim().slice(0, 100);
  return { companyName, question, searchQuery };
};

const buildDoubaoCustomPayload = (searchQuery: string) => {
  const query = searchQuery.replace(/\s+/g, ' ').trim().slice(0, 100);
  return {
    Query: query,
    SearchType: DOUBAO_CUSTOM_SEARCH_TYPE,
    Count: DOUBAO_CUSTOM_RESULT_COUNT,
    Filter: {
      NeedContent: true,
      NeedUrl: true,
      Sites: '',
      BlockHosts: '',
      AuthInfoLevel: 0,
    },
    NeedSummary: true,
    TimeRange: '',
    QueryControl: {
      QueryRewrite: false,
    },
  };
};

const parseJsonFromPossiblyStreamingText = (raw: string): any => {
  const text = (raw || '').trim();
  if (!text) return {};

  const tryParse = (candidate: string): any | null => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const direct = tryParse(text);
  if (
    direct?.Result?.CustomSearchResp ||
    direct?.Result?.WebResults ||
    direct?.choices ||
    direct?.error ||
    direct?.ResponseMetadata
  ) {
    return direct;
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => (line.startsWith('data:') ? line.slice(5).trim() : line))
    .filter(line => line && line !== '[DONE]');

  let fallback: any = direct || {};
  for (const line of lines) {
    const parsed = tryParse(line);
    if (!parsed) continue;
    if (parsed?.Result?.CustomSearchResp || parsed?.Result?.WebResults) return parsed;
    if (parsed?.choices || parsed?.error || parsed?.ResponseMetadata) {
      fallback = parsed;
    }
  }
  return fallback;
};

const mergeUsage = (...usages: Array<UsageMetrics | undefined>): UsageMetrics => {
  const merged: UsageMetrics = {};
  for (const usage of usages) {
    if (!usage) continue;
    merged.promptTokens = (merged.promptTokens || 0) + (usage.promptTokens || 0);
    merged.completionTokens = (merged.completionTokens || 0) + (usage.completionTokens || 0);
    merged.reasoningTokens = (merged.reasoningTokens || 0) + (usage.reasoningTokens || 0);
    merged.totalTokens = (merged.totalTokens || 0) + (usage.totalTokens || 0);
    merged.estimatedCostUsd = (merged.estimatedCostUsd || 0) + (usage.estimatedCostUsd || 0);
  }
  if (!merged.promptTokens && !merged.completionTokens && !merged.totalTokens) {
    return {};
  }
  return merged;
};

const buildDoubaoSearchContextText = (data: any, maxResults = 10): string => {
  const webResults = parseDoubaoCustomWebResults(data).slice(0, maxResults);
  if (!webResults.length) return '';
  const lines = webResults.map((item: any, index: number) => {
    const title = typeof item?.Title === 'string' ? item.Title.trim() : `Result ${index + 1}`;
    const snippet =
      (typeof item?.Snippet === 'string' && item.Snippet.trim()) ||
      (typeof item?.Summary === 'string' && item.Summary.trim()) ||
      (typeof item?.Content === 'string' && item.Content.trim()) ||
      '';
    const url = typeof item?.Url === 'string' ? item.Url.trim() : '';
    const normalizedSnippet = snippet.replace(/\s+/g, ' ').slice(0, 900);
    const urlSuffix = url ? ` (${url})` : '';
    return `- ${title}${urlSuffix}${normalizedSnippet ? `: ${normalizedSnippet}` : ''}`;
  });
  const query =
    data?.Result?.SearchContext?.OriginQuery ||
    data?.Result?.CustomSearchResp?.SearchContext?.OriginQuery;
  const prefix = typeof query === 'string' && query.trim() ? `Search results for "${query.trim()}":` : 'Search results:';
  return `${prefix}\n${lines.join('\n')}`.trim();
};

const buildDoubaoSynthesisPrompt = (originalPrompt: string, searchContextText: string, resultCount: number): string => {
  const searchSection = searchContextText.trim()
    ? searchContextText.trim()
    : 'No web results were returned for this query.';

  return `${originalPrompt}

Use the following web search results as your primary evidence. Synthesize a coherent financial analyst answer — do NOT simply paste the bullet list back.

Web search results (${resultCount} pages retrieved):
${searchSection}

Answer requirements:
- Follow the language and recency rules from the original task above.
- Ground every key claim in the search results; do not invent unsupported facts.
- Include period labels (YYYY-Qx, YYYY annual report, YYYY-MM) for material numbers.
- If the search results are insufficient, clearly state the limitation and what is missing.
- Write in clear prose suitable for an investment research report (not a raw search dump).`;
};

const buildVertexGoogleSearchContextText = (
  chunks: Array<{ web?: { uri?: string; title?: string }; retrievedContext?: { text?: string } }>,
  modelText: string
): string => {
  const lines = chunks
    .map((chunk, index) => {
      const title = chunk.web?.title?.trim() || `Google result ${index + 1}`;
      const uri = chunk.web?.uri?.trim() || '';
      const snippet =
        (typeof chunk.retrievedContext?.text === 'string' && chunk.retrievedContext.text.trim()) ||
        '';
      const normalized = snippet.replace(/\s+/g, ' ').slice(0, 900);
      const urlSuffix = uri ? ` (${uri})` : '';
      return `- ${title}${urlSuffix}${normalized ? `: ${normalized}` : ''}`;
    })
    .filter(Boolean);

  if (lines.length > 0) {
    return `Google Search results:\n${lines.join('\n')}`;
  }

  const fallback = (modelText || '').trim();
  return fallback
    ? `Google Search summary:\n${fallback.slice(0, 4000)}`
    : 'Google Search returned no extractable snippets.';
};

const buildAdvancedDualSearchSynthesisPrompt = (
  originalPrompt: string,
  doubaoContextText: string,
  doubaoCount: number,
  googleContextText: string,
  googleCount: number
): string => {
  const doubaoSection = doubaoContextText.trim() || 'No Doubao web results were returned.';
  const googleSection = googleContextText.trim() || 'No Google Search results were returned.';

  return `${originalPrompt}

You have TWO independent web search sources. Synthesize one coherent financial analyst answer.

Source A — Doubao web search (${doubaoCount} pages):
${doubaoSection}

Source B — Google Search (${googleCount} sources, PRIORITY ON CONFLICTS):
${googleSection}

Merge & conflict rules:
- Use BOTH sources; prefer unique facts from each when they complement each other.
- If Source A and Source B disagree on a material fact (numbers, dates, events, company identity), TRUST Source B (Google Search).
- When only Source A has evidence for a non-controversial point, you may use it.
- Follow the language, recency, and company-identity rules from the original task above.
- Ground every key claim in the merged evidence; do not invent unsupported facts.
- Include period labels (YYYY-Qx, YYYY annual report, YYYY-MM) for material numbers.
- If evidence is insufficient, clearly state the limitation.
- Write in clear prose suitable for an investment research report (not a raw search dump).`;
};

const getDoubaoResultCount = (data: any, webResults: any[]): number => {
  const result = data?.Result;
  if (typeof result?.ResultCount === 'number') return result.ResultCount;
  if (typeof result?.CustomSearchResp?.ResultCount === 'number') return result.CustomSearchResp.ResultCount;
  return webResults.length;
};

const logDoubaoSearchDiagnostics = (data: any, query: string, webResults: any[]) => {
  const customResp = data?.Result?.CustomSearchResp;
  const directWebResults = data?.Result?.WebResults;
  const snippetsWithText = webResults.filter(item => {
    const snippet =
      (typeof item?.Snippet === 'string' && item.Snippet.trim()) ||
      (typeof item?.Summary === 'string' && item.Summary.trim()) ||
      (typeof item?.Content === 'string' && item.Content.trim()) ||
      '';
    return Boolean(snippet);
  }).length;

  console.info('[Doubao Search]', JSON.stringify({
    query,
    queryLength: query.length,
    requestId: data?.ResponseMetadata?.RequestId,
    action: data?.ResponseMetadata?.Action,
    service: data?.ResponseMetadata?.Service,
    resultCount: getDoubaoResultCount(data, webResults),
    webResultsLength: webResults.length,
    snippetsWithText,
    hasDirectWebResults: Array.isArray(directWebResults),
    hasCustomSearchResp: Boolean(customResp),
    resultShape: Array.isArray(directWebResults)
      ? 'Result.WebResults'
      : customResp
        ? 'Result.CustomSearchResp.WebResults'
        : 'unknown',
    error: data?.error || data?.Error || data?.ResponseMetadata?.Error,
  }));
};

const isDoubaoRateLimitResponse = (data: any): boolean => {
  const err = data?.error || data?.Error || data?.ResponseMetadata?.Error;
  const code = String(err?.Code ?? err?.CodeN ?? '');
  const message = String(err?.Message ?? err?.message ?? '');
  return code === '700429' || /frequency exceeded|rate limit/i.test(message);
};

const getDoubaoRetryDelayMs = (attempt: number): number =>
  Math.min(30_000, 2_000 * 2 ** (attempt - 1) + Math.random() * 500);

const doubaoSearchSemaphore = new AsyncSemaphore(DOUBAO_SEARCH_CONCURRENCY);

const extractTextFromModelMessage = (message: any): string => {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const normalizeSource = (value: any): { uri: string; title: string } | null => {
  const uri =
    value?.uri ||
    value?.url ||
    value?.link ||
    value?.web?.uri ||
    value?.source?.uri ||
    value?.source_url;
  if (typeof uri !== 'string' || !uri.trim()) return null;
  const title =
    value?.title ||
    value?.name ||
    value?.web?.title ||
    value?.source?.title ||
    value?.site ||
    uri;
  return { uri: uri.trim(), title: typeof title === 'string' && title.trim() ? title.trim() : uri.trim() };
};

const parseDoubaoGroundingChunks = (data: any): Array<{ web: { uri: string; title: string } }> => {
  const message = data?.choices?.[0]?.message;
  const candidates = [
    ...(Array.isArray(data?.references) ? data.references : []),
    ...(Array.isArray(data?.citations) ? data.citations : []),
    ...(Array.isArray(message?.references) ? message.references : []),
    ...(Array.isArray(message?.citations) ? message.citations : []),
    ...(Array.isArray(message?.annotations) ? message.annotations : []),
    ...(Array.isArray(message?.search_results) ? message.search_results : []),
  ];
  const chunks = candidates
    .map(normalizeSource)
    .filter((item): item is { uri: string; title: string } => Boolean(item))
    .map(item => ({ web: item }));
  const deduped = new Map<string, { web: { uri: string; title: string } }>();
  for (const chunk of chunks) {
    deduped.set(chunk.web.uri, chunk);
  }
  return Array.from(deduped.values());
};

const parseVertexGroundingChunks = (
  rawChunks: Array<{ web?: { uri?: string; title?: string; url?: string } }>
): Array<{ web: { uri: string; title: string } }> => {
  const deduped = new Map<string, { web: { uri: string; title: string } }>();
  for (const chunk of rawChunks) {
    const uri = (chunk?.web?.uri || chunk?.web?.url || '').trim();
    if (!uri) continue;
    const title = (chunk?.web?.title || uri).trim();
    deduped.set(uri, { web: { uri, title } });
  }
  return Array.from(deduped.values());
};

const mergeGroundingChunks = (
  ...groups: Array<Array<{ web: { uri: string; title: string } }>>
): Array<{ web: { uri: string; title: string } }> => {
  const deduped = new Map<string, { web: { uri: string; title: string } }>();
  for (const group of groups) {
    for (const chunk of group) {
      deduped.set(chunk.web.uri, chunk);
    }
  }
  return Array.from(deduped.values());
};

const parseDoubaoCustomWebResults = (data: any): any[] => {
  // APIKey endpoint returns Result.WebResults; older/custom docs use Result.CustomSearchResp.WebResults.
  const webResults = data?.Result?.WebResults ?? data?.Result?.CustomSearchResp?.WebResults;
  return Array.isArray(webResults) ? webResults : [];
};

const parseDoubaoCustomGroundingChunks = (data: any): Array<{ web: { uri: string; title: string } }> => {
  const webResults = parseDoubaoCustomWebResults(data);
  const chunks = webResults
    .map((item: any) => {
      const uri = typeof item?.Url === 'string' ? item.Url.trim() : '';
      if (!uri) return null;
      const title =
        (typeof item?.Title === 'string' && item.Title.trim()) ||
        (typeof item?.SiteName === 'string' && item.SiteName.trim()) ||
        uri;
      return { web: { uri, title } };
    })
    .filter((item): item is { web: { uri: string; title: string } } => Boolean(item));
  const deduped = new Map<string, { web: { uri: string; title: string } }>();
  for (const chunk of chunks) {
    deduped.set(chunk.web.uri, chunk);
  }
  return Array.from(deduped.values());
};

const getVertexSearchFallbackModel = () =>
  (process.env.VERTEX_SEARCH_MODEL && process.env.VERTEX_SEARCH_MODEL.trim()) ||
  'gemini-3-flash-preview';

const extractTextFromContents = (contents: any): string => {
  if (typeof contents === 'string') {
    return contents;
  }
  if (Array.isArray(contents)) {
    return contents.map(item => extractTextFromContents(item)).join('\n');
  }
  if (contents && typeof contents === 'object') {
    if (Array.isArray(contents.parts)) {
      return contents.parts
        .map((part: any) => {
          if (typeof part?.text === 'string') {
            return part.text;
          }
          return '';
        })
        .join('\n');
    }
  }
  return '';
};

const estimateCost = (isSearch: boolean, usage: UsageMetrics): number | undefined => {
  const inputPrice = isSearch ? SEARCH_INPUT_COST_PER_MILLION_USD : ANALYSIS_INPUT_COST_PER_MILLION_USD;
  const outputPrice = isSearch ? SEARCH_OUTPUT_COST_PER_MILLION_USD : ANALYSIS_OUTPUT_COST_PER_MILLION_USD;
  if (inputPrice <= 0 && outputPrice <= 0) {
    return undefined;
  }
  const promptTokens = usage.promptTokens || 0;
  const completionTokens = usage.completionTokens || 0;
  const estimated =
    (promptTokens / 1_000_000) * Math.max(0, inputPrice) +
    (completionTokens / 1_000_000) * Math.max(0, outputPrice);
  return Number.isFinite(estimated) ? estimated : undefined;
};

const parseVertexUsage = (response: any, isSearch: boolean): UsageMetrics => {
  const raw = response?.usageMetadata;
  const usage: UsageMetrics = {
    promptTokens: raw?.promptTokenCount,
    completionTokens: raw?.candidatesTokenCount,
    totalTokens: raw?.totalTokenCount,
  };
  usage.estimatedCostUsd = estimateCost(isSearch, usage);
  return usage;
};

const parseDeepSeekUsage = (rawUsage: any, isSearch: boolean): UsageMetrics => {
  const reasoningTokens =
    rawUsage?.completion_tokens_details?.reasoning_tokens ??
    rawUsage?.reasoning_tokens ??
    undefined;
  const usage: UsageMetrics = {
    promptTokens: rawUsage?.prompt_tokens,
    completionTokens: rawUsage?.completion_tokens,
    reasoningTokens: typeof reasoningTokens === 'number' ? reasoningTokens : undefined,
    totalTokens: rawUsage?.total_tokens,
  };
  usage.estimatedCostUsd = estimateCost(isSearch, usage);
  return usage;
};

export class ModelClient {
  constructor(
    private vertexClient: GoogleGenAI,
    private onTelemetry?: (entry: LlmCallTelemetry) => void
  ) {}

  private emitTelemetry(entry: LlmCallTelemetry) {
    if (this.onTelemetry) {
      this.onTelemetry(entry);
    }
    console.info('[LLM]', JSON.stringify(entry));
  }

  private chooseProviderAndModel(params: GenerateParams): { provider: ModelProvider | 'doubao'; model: string; isSearch: boolean } {
    const runtime = getRuntimeModelConfig();
    const requiresSearch = Boolean(params.requireGoogleSearch || params.config?.tools?.some((tool: any) => tool?.googleSearch));
    if (requiresSearch) {
      const requestSearchProvider =
        params.provider === 'doubao' || params.provider === 'vertex' ? params.provider : undefined;
      return {
        provider: requestSearchProvider || runtime.search.provider,
        model: params.model || runtime.search.model,
        isSearch: true,
      };
    }
    return {
      provider: params.provider || runtime.analysis.provider,
      model: params.model || runtime.analysis.model,
      isSearch: false,
    };
  }

  private sanitizeVertexModel(model: string): string {
    const normalized = (model || '').trim().toLowerCase();
    const runtime = getRuntimeModelConfig();
    const safeVertexModel = runtime.search.provider === 'vertex' ? runtime.search.model : getVertexSearchFallbackModel();
    // Guardrail: prevent non-Vertex model names being sent to Vertex endpoint.
    if (!normalized || normalized.includes('deepseek') || normalized.includes('kimi') || normalized.includes('doubao')) {
      return safeVertexModel;
    }
    return model;
  }

  private async executeDoubaoSearchOnce(originalPrompt: string): Promise<{
    data: any;
    webResults: any[];
    groundingChunks: Array<{ web: { uri: string; title: string } }>;
    searchContextText: string;
    query: string;
    usage: UsageMetrics;
  }> {
    const doubaoApiKey = DOUBAO_CUSTOM_API_KEY || DOUBAO_SEARCH_API_KEY;
    if (!doubaoApiKey) {
      throw new Error('DOUBAO_CUSTOM_API_KEY (or DOUBAO_SEARCH_API_KEY) is missing while search provider is doubao.');
    }

    const { searchQuery } = extractDoubaoQnaContext(originalPrompt);
    const payload = buildDoubaoCustomPayload(searchQuery);

    const response = await fetch(DOUBAO_CUSTOM_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${doubaoApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Doubao search call failed (${response.status}): ${text || 'unknown error'}`);
    }
    const bodyText = await response.text().catch(() => '');
    const data = parseJsonFromPossiblyStreamingText(bodyText);

    const webResults = parseDoubaoCustomWebResults(data);
    const message = data?.choices?.[0]?.message;
    const groundingChunksFromChat = parseDoubaoGroundingChunks(data);
    const groundingChunksFromCustomSearch = parseDoubaoCustomGroundingChunks(data);
    const groundingChunks =
      groundingChunksFromChat.length > 0 ? groundingChunksFromChat : groundingChunksFromCustomSearch;
    const searchContextText =
      buildDoubaoSearchContextText(data) || extractTextFromModelMessage(message);

    return {
      data,
      webResults,
      groundingChunks,
      searchContextText,
      query: searchQuery,
      usage: parseDeepSeekUsage(data?.usage, true),
    };
  }

  private async executeDoubaoSearch(originalPrompt: string): Promise<{
    data: any;
    webResults: any[];
    groundingChunks: Array<{ web: { uri: string; title: string } }>;
    searchContextText: string;
    query: string;
    usage: UsageMetrics;
  }> {
    return doubaoSearchSemaphore.run(async () => {
      let lastResult: Awaited<ReturnType<ModelClient['executeDoubaoSearchOnce']>> | null = null;

      for (let attempt = 1; attempt <= DOUBAO_SEARCH_MAX_ATTEMPTS; attempt++) {
        try {
          const result = await this.executeDoubaoSearchOnce(originalPrompt);
          lastResult = result;

          if (result.webResults.length > 0) {
            return result;
          }

          const rateLimited = isDoubaoRateLimitResponse(result.data);
          if (rateLimited && attempt < DOUBAO_SEARCH_MAX_ATTEMPTS) {
            console.warn(
              `[Doubao Search] rate limited (700429), retry ${attempt}/${DOUBAO_SEARCH_MAX_ATTEMPTS} query="${result.query}"`
            );
            await sleep(getDoubaoRetryDelayMs(attempt));
            continue;
          }

          throw new Error(
            `Doubao search returned 0 results${rateLimited ? ' (700429 rate limit)' : ''} for query="${result.query}"`
          );
        } catch (error: any) {
          const message = formatRetryableErrorMessage(error);
          const retryable = RETRYABLE_ERROR_PATTERN.test(message);
          if (!retryable || attempt === DOUBAO_SEARCH_MAX_ATTEMPTS) {
            throw error;
          }
          console.warn(`[Doubao Search] retry ${attempt}/${DOUBAO_SEARCH_MAX_ATTEMPTS}: ${message}`);
          await sleep(getDoubaoRetryDelayMs(attempt));
        }
      }

      if (lastResult) {
        throw new Error(`Doubao search returned 0 results for query="${lastResult.query}"`);
      }
      throw new Error('Doubao search failed after retries.');
    });
  }

  private async executeVertexGoogleSearch(originalPrompt: string): Promise<{
    groundingChunks: Array<{ web: { uri: string; title: string } }>;
    searchContextText: string;
    usage: UsageMetrics;
  }> {
    const model = getVertexSearchFallbackModel();
    const result = await this.vertexClient.models.generateContent({
      model,
      contents: { role: 'user', parts: [{ text: originalPrompt }] },
      config: { tools: [{ googleSearch: {} }] },
    });

    const rawChunks = result?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingChunks = parseVertexGroundingChunks(rawChunks);
    const searchContextText = buildVertexGoogleSearchContextText(rawChunks, result?.text || '');
    const usage = parseVertexUsage(result, true);

    return { groundingChunks, searchContextText, usage };
  }

  private async executeVertexGoogleSearchSafe(originalPrompt: string): Promise<{
    groundingChunks: Array<{ web: { uri: string; title: string } }>;
    searchContextText: string;
    usage: UsageMetrics;
  } | null> {
    try {
      return await this.executeVertexGoogleSearch(originalPrompt);
    } catch (error) {
      console.warn('[Advanced Search] Google Search stage failed:', error);
      return null;
    }
  }

  /**
   * Doubao Q&A uses a dedicated two-stage pipeline (search → analysis synthesis).
   * Advanced mode adds a Google Search stage and merges both before synthesis.
   * Vertex-only Google Search path is unchanged and handled separately in generateContent().
   */
  private async generateDoubaoAnswerQuestion(
    params: GenerateParams,
    chosen: { provider: 'doubao'; model: string; isSearch: boolean },
    startedAt: Date,
    startMs: number
  ): Promise<ModelResponse> {
    const originalPrompt = extractTextFromContents(params.contents);
    const runtime = getRuntimeModelConfig();

    const searchStageStartedAt = new Date();
    const searchStageStartMs = Date.now();
    const searchResult = await this.executeDoubaoSearch(originalPrompt);

    logDoubaoSearchDiagnostics(searchResult.data, searchResult.query, searchResult.webResults);

    this.emitTelemetry({
      step: 'doubao_search',
      provider: 'doubao',
      model: chosen.model,
      startedAt: searchStageStartedAt.toISOString(),
      durationMs: Date.now() - searchStageStartMs,
      usage: searchResult.usage,
    });

    const isAdvancedSearch = runtime.searchMode === 'advanced';
    let googleResult: {
      groundingChunks: Array<{ web: { uri: string; title: string } }>;
      searchContextText: string;
      usage: UsageMetrics;
    } | null = null;

    if (isAdvancedSearch) {
      const googleStageStartedAt = new Date();
      const googleStageStartMs = Date.now();
      googleResult = await this.executeVertexGoogleSearchSafe(originalPrompt);
      if (googleResult) {
        this.emitTelemetry({
          step: 'google_search',
          provider: 'vertex',
          model: getVertexSearchFallbackModel(),
          startedAt: googleStageStartedAt.toISOString(),
          durationMs: Date.now() - googleStageStartMs,
          usage: googleResult.usage,
        });
      }
    }

    const synthesisPrompt =
      isAdvancedSearch && googleResult
        ? buildAdvancedDualSearchSynthesisPrompt(
            originalPrompt,
            searchResult.searchContextText,
            searchResult.webResults.length,
            googleResult.searchContextText,
            googleResult.groundingChunks.length
          )
        : buildDoubaoSynthesisPrompt(
            originalPrompt,
            searchResult.searchContextText,
            searchResult.webResults.length
          );

    const synthesisResponse = await this.generateContent({
      step: 'answer_question_synthesis',
      contents: { role: 'user', parts: [{ text: synthesisPrompt }] },
      provider: runtime.analysis.provider,
      model: runtime.analysis.model,
      requireGoogleSearch: false,
    });

    const mergedUsage = mergeUsage(
      searchResult.usage,
      googleResult?.usage,
      synthesisResponse.usage
    );
    const durationMs = Date.now() - startMs;
    const mergedGrounding = mergeGroundingChunks(
      searchResult.groundingChunks,
      googleResult?.groundingChunks || []
    );

    this.emitTelemetry({
      step: params.step === 'follow_up_answer_question' ? 'follow_up_answer_question' : 'answer_question',
      provider: 'doubao',
      model: chosen.model,
      startedAt: startedAt.toISOString(),
      durationMs,
      usage: mergedUsage,
    });

    if (!synthesisResponse.text?.trim()) {
      console.warn('[Doubao Search] synthesis returned empty text', JSON.stringify({
        query: searchResult.query,
        webResultsLength: searchResult.webResults.length,
        googleChunks: googleResult?.groundingChunks.length || 0,
        advanced: isAdvancedSearch,
        analysisProvider: runtime.analysis.provider,
        analysisModel: runtime.analysis.model,
      }));
    }

    return {
      text: synthesisResponse.text,
      candidates: mergedGrounding.length
        ? [{ groundingMetadata: { groundingChunks: mergedGrounding } }]
        : [],
      groundingMetadata: mergedGrounding.length ? { groundingChunks: mergedGrounding } : undefined,
      usage: mergedUsage,
      provider: 'doubao',
      model: chosen.model,
    };
  }

  async generateContent(params: GenerateParams): Promise<ModelResponse> {
    const chosen = this.chooseProviderAndModel(params);
    if (chosen.provider === 'vertex') {
      chosen.model = this.sanitizeVertexModel(chosen.model);
    }
    const startedAt = new Date();
    const startMs = Date.now();

    try {
      if (chosen.provider === 'doubao') {
        if (
          params.step === 'answer_question' ||
          params.step === 'follow_up_answer_question' ||
          params.step === 'market_hot_topics'
        ) {
          return await this.generateDoubaoAnswerQuestion(
            params,
            { provider: 'doubao', model: chosen.model, isSearch: chosen.isSearch },
            startedAt,
            startMs
          );
        }
        throw new Error(`Doubao provider is only supported for answer_question, follow_up_answer_question and market_hot_topics, got step=${params.step}`);
      }

      if (chosen.provider === 'deepseek') {
        if (!DEEPSEEK_API_KEY) {
          throw new Error('DEEPSEEK_API_KEY is missing while analysis provider is deepseek.');
        }

        let data: any = null;
        let lastError: any = null;
        const maxAttempts = getDeepSeekMaxAttempts(params.step);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const prompt = extractTextFromContents(params.contents);
            const payload = buildDeepSeekPayload(params, chosen.model, prompt);

            const response = await fetch(DEEPSEEK_BASE_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(getDeepSeekTimeoutMs(params.step)),
            });

            if (!response.ok) {
              const text = await response.text().catch(() => '');
              throw new Error(`DeepSeek call failed (${response.status}): ${text || 'unknown error'}`);
            }

            data = await response.json();
            lastError = null;
            break;
          } catch (error: any) {
            lastError = error;
            const message = formatRetryableErrorMessage(error);
            const retryable = RETRYABLE_ERROR_PATTERN.test(message);
            if (!retryable || attempt === maxAttempts) {
              throw error;
            }
            await sleep(getDeepSeekRetryDelayMs(attempt, message));
          }
        }
        if (!data && lastError) {
          throw lastError;
        }

        const message = data?.choices?.[0]?.message;
        const wantsJson = params.config?.responseMimeType === 'application/json';
        const resolved = resolveDeepSeekResponseText(message, wantsJson);
        const text = resolved.text;
        const usage = parseDeepSeekUsage(data?.usage, chosen.isSearch);
        const durationMs = Date.now() - startMs;
        const reasoningEffort = getDeepSeekReasoningEffort(params.step);
        const thinkingEnabled = shouldUseDeepSeekThinking(params.step);
        this.emitTelemetry({
          step: params.step,
          provider: chosen.provider,
          model: chosen.model,
          startedAt: startedAt.toISOString(),
          durationMs,
          usage,
        });
        if (params.step === QNA_SYNTHESIS_STEP) {
          console.info(
            `[LLM] qna synthesis thinking=${thinkingEnabled ? 'enabled' : 'disabled'} effort=${thinkingEnabled ? reasoningEffort : 'n/a'} reasoningTokens=${usage.reasoningTokens ?? 0}`
          );
        }
        if (message?.reasoning_content) {
          console.info(
            `[LLM] deepseek thinking step=${params.step} effort=${reasoningEffort} reasoningChars=${message.reasoning_content.length}`
          );
        }
        if (resolved.recoveredFromReasoning) {
          console.warn(
            `[LLM] deepseek JSON recovered from reasoning_content step=${params.step} contentChars=${(message?.content || '').length}`
          );
        }
        if (wantsJson && !text) {
          console.warn(`[LLM] deepseek empty JSON content step=${params.step}`);
        }
        return {
          text,
          usage,
          provider: chosen.provider,
          model: chosen.model,
        };
      }

      const maxAttempts = 3;
      let result: any = null;
      let lastError: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          result = await this.vertexClient.models.generateContent({
            model: chosen.model,
            contents: params.contents,
            config: params.config || {},
          });
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          const message = error?.message || String(error);
          const retryable = RETRYABLE_ERROR_PATTERN.test(message);
          if (!retryable || attempt === maxAttempts) {
            throw error;
          }
          await sleep(300 * attempt);
        }
      }
      if (!result && lastError) {
        throw lastError;
      }

      const candidates = result?.candidates || [];
      const usage = parseVertexUsage(result, chosen.isSearch);
      const durationMs = Date.now() - startMs;
      this.emitTelemetry({
        step: params.step,
        provider: chosen.provider,
        model: chosen.model,
        startedAt: startedAt.toISOString(),
        durationMs,
        usage,
      });
      return {
        text: result?.text || '',
        candidates,
        groundingMetadata: candidates?.[0]?.groundingMetadata,
        usage,
        provider: chosen.provider,
        model: chosen.model,
      };
    } catch (error) {
      const durationMs = Date.now() - startMs;
      this.emitTelemetry({
        step: params.step,
        provider: chosen.provider,
        model: chosen.model,
        startedAt: startedAt.toISOString(),
        durationMs,
        usage: {},
      });
      throw error;
    }
  }
}
