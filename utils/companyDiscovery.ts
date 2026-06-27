import type { CompanyProfile } from '../types.ts';
import { parseModelJsonResponse, tryParseModelJson } from './modelJson.ts';

const COMPETITORS_JSON_EXAMPLE_CN = `{
  "competitors": [
    { "name": "派能科技", "ticker": "688063", "exchange": "SSE" },
    { "name": "锦浪科技", "ticker": "300763", "exchange": "SZSE" }
  ]
}`;

const COMPETITORS_JSON_EXAMPLE_EN = `{
  "competitors": [
    { "name": "Enphase Energy", "ticker": "ENPH", "exchange": "NASDAQ" },
    { "name": "SolarEdge Technologies", "ticker": "SEDG", "exchange": "NASDAQ" }
  ]
}`;

const CONCEPT_JSON_EXAMPLE_CN = `{
  "focusCompany": { "name": "艾罗能源", "ticker": "688717", "exchange": "SSE" },
  "candidateCompanies": [
    { "name": "派能科技", "ticker": "688063", "exchange": "SSE" },
    { "name": "锦浪科技", "ticker": "300763", "exchange": "SZSE" }
  ]
}`;

const CONCEPT_JSON_EXAMPLE_EN = `{
  "focusCompany": { "name": "Enphase Energy", "ticker": "ENPH", "exchange": "NASDAQ" },
  "candidateCompanies": [
    { "name": "SolarEdge Technologies", "ticker": "SEDG", "exchange": "NASDAQ" },
    { "name": "Generac Holdings", "ticker": "GNRC", "exchange": "NYSE" }
  ]
}`;

const EXCHANGE_ALIASES: Array<[RegExp, string]> = [
  [/shanghai|sse|上交所|上海证券|科创板/i, 'SSE'],
  [/shenzhen|szse|深交所|深圳证券|创业板/i, 'SZSE'],
  [/hong\s*kong|hkex|港交所|香港/i, 'HKEX'],
  [/nasdaq/i, 'NASDAQ'],
  [/nyse|new\s*york/i, 'NYSE'],
  [/amex|american/i, 'AMEX'],
];

export const normalizeExchangeCode = (exchange: string): string => {
  const trimmed = (exchange || '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (['SSE', 'SZSE', 'HKEX', 'NASDAQ', 'NYSE', 'AMEX'].includes(upper)) return upper;
  for (const [pattern, code] of EXCHANGE_ALIASES) {
    if (pattern.test(trimmed)) return code;
  }
  return trimmed;
};

export const inferExchangeFromTicker = (ticker: string): string => {
  const raw = (ticker || '').trim().toUpperCase();
  if (!raw) return '';

  if (/\.HK$/i.test(raw) || /^\d{5}$/.test(raw.replace(/\.HK$/i, ''))) return 'HKEX';
  if (/\.(SH|SS)$/i.test(raw)) return 'SSE';
  if (/\.SZ$/i.test(raw)) return 'SZSE';

  const base = raw.replace(/\.(SH|SZ|HK|SS)$/i, '');
  if (/^\d{6}$/.test(base)) {
    if (/^(688|689|600|601|603|605|730|900)/.test(base)) return 'SSE';
    if (/^(000|001|002|003|300|301)/.test(base)) return 'SZSE';
  }
  if (/^[A-Z]{1,5}$/.test(base)) return 'NASDAQ';
  return '';
};

export const normalizeCompanyRecord = (
  raw: unknown
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const rawTicker = typeof record.ticker === 'string' ? record.ticker.trim() : '';
  if (!name || !rawTicker) return null;

  const ticker = rawTicker.toUpperCase().replace(/\.(SH|SZ|HK|SS)$/i, '');
  let exchange =
    typeof record.exchange === 'string' ? normalizeExchangeCode(record.exchange) : '';
  if (!exchange) exchange = inferExchangeFromTicker(rawTicker);
  if (!exchange) return null;

  return { name, ticker, exchange };
};

const collectCompanyArrays = (parsed: Record<string, unknown>): unknown[] => {
  const arrays: unknown[] = [];
  for (const key of [
    'competitors',
    'candidateCompanies',
    'candidate_companies',
    'companies',
    'results',
    'peers',
  ]) {
    const value = parsed[key];
    if (Array.isArray(value)) arrays.push(...value);
  }
  return arrays;
};

export const parseCompetitorsResponse = (
  rawText: string
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] => {
  const parsed = (tryParseModelJson(rawText) || {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const results: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

  for (const item of collectCompanyArrays(parsed)) {
    const company = normalizeCompanyRecord(item);
    if (!company) continue;
    const key = company.ticker.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(company);
  }

  return results;
};

export const parseConceptDiscoveryResponse = (
  rawText: string
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] => {
  const parsed = (tryParseModelJson(rawText) || {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const results: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];

  const push = (item: unknown) => {
    const company = normalizeCompanyRecord(item);
    if (!company) return;
    const key = company.ticker.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(company);
  };

  push(parsed.focusCompany ?? parsed.focus_company);
  for (const item of collectCompanyArrays(parsed)) {
    push(item);
  }

  return results;
};

export const buildFindCompetitorsPrompt = (
  focusCompany: Pick<CompanyProfile, 'name' | 'ticker'>,
  outputLanguage: string,
  strictRetry = false
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const example = isChinese ? COMPETITORS_JSON_EXAMPLE_CN : COMPETITORS_JSON_EXAMPLE_EN;

  const base = `You are a senior equity research analyst. The focus company is "${focusCompany.name}" (ticker: ${focusCompany.ticker}).

Identify exactly TWO main publicly traded competitors in the SAME industry/product category.
- Markets allowed: US, Hong Kong (HKEX), or mainland China A-share (SSE/SZSE) only.
- Use real, currently listed companies with correct tickers.
- "exchange" MUST be one of: NASDAQ, NYSE, AMEX, HKEX, SSE, SZSE (not Chinese prose).
- Do NOT return an empty array. Do NOT return the focus company itself.
- Company names in ${outputLanguage}.

Return ONLY valid JSON with this exact shape:
${example}`;

  if (!strictRetry) return base;

  return `${base}

CRITICAL RETRY: Your previous response was empty or invalid. You MUST return exactly 2 competitors with non-empty name, ticker, and exchange fields. JSON key MUST be "competitors".`;
};

export const buildFindCompaniesByConceptPrompt = (
  query: string,
  outputLanguage: string,
  strictRetry = false
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const example = isChinese ? CONCEPT_JSON_EXAMPLE_CN : CONCEPT_JSON_EXAMPLE_EN;

  const base = `The user searched for: "${query}". No direct ticker match was found.

1) Pick the single most prominent publicly traded company related to this concept as "focusCompany".
2) Pick TWO other relevant publicly traded competitors as "candidateCompanies".
- Markets allowed: US, Hong Kong (HKEX), or mainland China A-share (SSE/SZSE) only.
- Use real listed companies with correct tickers.
- "exchange" MUST be one of: NASDAQ, NYSE, AMEX, HKEX, SSE, SZSE.
- Do NOT return empty arrays.
- Company names in ${outputLanguage}.

Return ONLY valid JSON with this exact shape:
${example}`;

  if (!strictRetry) return base;

  return `${base}

CRITICAL RETRY: Previous JSON was invalid or empty. Return focusCompany plus exactly 2 candidateCompanies with name, ticker, exchange.`;
};

export const parseDiscoveryJson = (rawText: string): unknown =>
  parseModelJsonResponse(rawText || '{}');
