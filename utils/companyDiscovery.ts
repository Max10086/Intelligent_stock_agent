import type { CompanyProfile } from '../types.ts';
import { parseModelJsonResponse, tryParseModelJson } from './modelJson.ts';
import { parseSearchQuery } from './searchQueryIntent.ts';

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

export type EquityMarket = 'US' | 'HK' | 'CN';

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const CN_EXCHANGES = new Set(['SSE', 'SZSE']);

export const resolveFocusExchange = (
  focus: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> => ({
  ...focus,
  exchange: normalizeExchangeCode(focus.exchange) || inferExchangeFromTicker(focus.ticker),
});

export const getEquityMarket = (
  profile: Pick<CompanyProfile, 'ticker' | 'exchange'>
): EquityMarket | null => {
  const exchange =
    normalizeExchangeCode(profile.exchange) || inferExchangeFromTicker(profile.ticker);
  if (US_EXCHANGES.has(exchange)) return 'US';
  if (exchange === 'HKEX') return 'HK';
  if (CN_EXCHANGES.has(exchange)) return 'CN';
  return null;
};

export const isSameEquityMarket = (
  a: Pick<CompanyProfile, 'ticker' | 'exchange'>,
  b: Pick<CompanyProfile, 'ticker' | 'exchange'>
): boolean => {
  const marketA = getEquityMarket(a);
  const marketB = getEquityMarket(b);
  return Boolean(marketA && marketB && marketA === marketB);
};

const MARKET_LABELS: Record<EquityMarket, { en: string; cn: string }> = {
  US: {
    en: 'US stock market (NASDAQ, NYSE, or AMEX)',
    cn: '美股市场（NASDAQ、NYSE 或 AMEX）',
  },
  HK: {
    en: 'Hong Kong stock market (HKEX)',
    cn: '港股市场（HKEX）',
  },
  CN: {
    en: 'mainland China A-share market (SSE or SZSE)',
    cn: 'A 股市场（上交所 SSE 或深交所 SZSE）',
  },
};

const dedupeCompetitors = (
  competitors: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] => {
  const seen = new Set<string>();
  const results: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];
  for (const company of competitors) {
    const key = company.ticker.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(company);
  }
  return results;
};

export const prioritizeCompetitorsByMarket = (
  focus: Pick<CompanyProfile, 'ticker' | 'exchange'>,
  competitors: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[],
  limit = 2
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] => {
  const focusMarket = getEquityMarket(focus);
  if (!focusMarket) return dedupeCompetitors(competitors).slice(0, limit);

  const sameMarket: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];
  const otherMarket: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] = [];
  for (const company of dedupeCompetitors(competitors)) {
    if (getEquityMarket(company) === focusMarket) sameMarket.push(company);
    else otherMarket.push(company);
  }
  return [...sameMarket, ...otherMarket].slice(0, limit);
};

const filterSameMarketCompetitors = (
  focus: Pick<CompanyProfile, 'ticker' | 'exchange'>,
  competitors: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] =>
  dedupeCompetitors(competitors).filter(company => isSameEquityMarket(focus, company));

export const runCompetitorDiscovery = async (
  focusCompany: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  callDiscovery: (options: { strictRetry: boolean; allowCrossMarket: boolean }) => Promise<string>
): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]> => {
  const focus = resolveFocusExchange(focusCompany);
  const focusTicker = focus.ticker.toUpperCase();
  const excludeSelf = (
    competitors: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]
  ) => competitors.filter(c => c.ticker.toUpperCase() !== focusTicker);

  const parseAndSelect = (rawText: string, allowCrossMarket: boolean) => {
    const parsed = excludeSelf(parseCompetitorsResponse(rawText));
    return allowCrossMarket
      ? prioritizeCompetitorsByMarket(focus, parsed, 2)
      : filterSameMarketCompetitors(focus, parsed);
  };

  let competitors = parseAndSelect(await callDiscovery({ strictRetry: false, allowCrossMarket: false }), false);
  if (competitors.length >= 2) return competitors.slice(0, 2);

  competitors = parseAndSelect(await callDiscovery({ strictRetry: true, allowCrossMarket: false }), false);
  if (competitors.length >= 2) return competitors.slice(0, 2);

  if (getEquityMarket(focus)) {
    const crossMarket = parseAndSelect(
      await callDiscovery({ strictRetry: true, allowCrossMarket: true }),
      true
    );
    competitors = prioritizeCompetitorsByMarket(
      focus,
      dedupeCompetitors([...competitors, ...crossMarket]),
      2
    );
  }

  return competitors.slice(0, 2);
};

export const alignConceptDiscoveryByMarket = (
  companies: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[]
): Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>[] => {
  if (companies.length === 0) return [];
  const [focus, ...rest] = companies;
  const focusResolved = resolveFocusExchange(focus);
  const alignedCandidates = prioritizeCompetitorsByMarket(focusResolved, rest, 2);
  return [focusResolved, ...alignedCandidates].slice(0, 3);
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
  focusCompany: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  outputLanguage: string,
  options: { strictRetry?: boolean; allowCrossMarket?: boolean } = {}
): string => {
  const { strictRetry = false, allowCrossMarket = false } = options;
  const isChinese = /chinese/i.test(outputLanguage);
  const example = isChinese ? COMPETITORS_JSON_EXAMPLE_CN : COMPETITORS_JSON_EXAMPLE_EN;
  const focus = resolveFocusExchange(focusCompany);
  const focusMarket = getEquityMarket(focus);
  const marketLabel = focusMarket
    ? isChinese
      ? MARKET_LABELS[focusMarket].cn
      : MARKET_LABELS[focusMarket].en
    : '';

  const marketRules = focusMarket
    ? allowCrossMarket
      ? isChinese
        ? `- 优先在 ${marketLabel} 寻找与 focus 同市场的竞品；若该市场确实没有足够可比的上市公司，才允许从其他允许市场（美股 / 港股 / A 股）补充全球可比公司。
- 在 JSON 数组中，同市场竞品必须排在跨市场竞品之前。`
        : `- Prefer competitors listed on the SAME market as the focus company (${marketLabel}).
- Only if that market truly lacks adequate listed peers, you MAY add globally comparable companies from other allowed markets (US / HKEX / A-share).
- List same-market competitors BEFORE cross-market peers in the JSON array.`
      : isChinese
        ? `- focus 公司上市于 ${focus.exchange || '未知交易所'}（${marketLabel}）。
- 必须优先且仅选择 ${marketLabel} 的上市公司作为竞品；不要选择其他市场的公司。
- 例如 focus 为美股时，竞品必须是 NASDAQ/NYSE/AMEX；focus 为 A 股时，竞品必须是 SSE/SZSE；focus 为港股时，竞品必须是 HKEX。`
        : `- The focus company is listed on ${focus.exchange || 'unknown exchange'} (${marketLabel}).
- You MUST pick competitors listed on the SAME market only (${marketLabel}). Do NOT pick companies from other markets.
- Example: US focus → NASDAQ/NYSE/AMEX only; A-share focus → SSE/SZSE only; HK focus → HKEX only.`
    : isChinese
      ? '- 尽量让竞品与 focus 公司处于同一上市市场（美股 / 港股 / A 股）。'
      : '- Prefer competitors listed on the same market as the focus company (US / HK / A-share).';

  const base = `You are a senior equity research analyst. The focus company is "${focus.name}" (ticker: ${focus.ticker}${focus.exchange ? `, exchange: ${focus.exchange}` : ''}).

Identify exactly TWO main publicly traded competitors in the SAME industry/product category.
- Do NOT substitute a different company that merely shares a similar name or ticker on another exchange (e.g. US IREN vs Italy IRE.MI).
${marketRules}
- Allowed markets overall: US (NASDAQ/NYSE/AMEX), Hong Kong (HKEX), or mainland China A-share (SSE/SZSE).
- Use real, currently listed companies with correct tickers.
- "exchange" MUST be one of: NASDAQ, NYSE, AMEX, HKEX, SSE, SZSE (not Chinese prose).
- Do NOT return an empty array. Do NOT return the focus company itself.
- Company names in ${outputLanguage}.

Return ONLY valid JSON with this exact shape:
${example}`;

  if (!strictRetry) return base;

  const retryNote = allowCrossMarket
    ? isChinese
      ? '若同市场竞品不足 2 家，可补充其他市场的全球可比公司，但同市场公司必须排在前面。'
      : 'If fewer than 2 same-market peers exist, you may add cross-market comparables, but same-market names must come first.'
    : isChinese
      ? '必须返回恰好 2 家与 focus 同市场的竞品。'
      : 'You MUST return exactly 2 competitors on the SAME market as the focus company.';

  return `${base}

CRITICAL RETRY: Your previous response was empty, invalid, or used the wrong market. ${retryNote} JSON key MUST be "competitors".`;
};

export const buildFindCompaniesByConceptPrompt = (
  query: string,
  outputLanguage: string,
  strictRetry = false
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const example = isChinese ? CONCEPT_JSON_EXAMPLE_CN : CONCEPT_JSON_EXAMPLE_EN;
  const intent = parseSearchQuery(query);
  const marketHint = intent.preferredMarkets[0];
  const marketNote =
    marketHint === 'cn'
      ? isChinese
        ? '用户明确偏好 A 股（上交所/深交所）。focusCompany 必须是 SSE 或 SZSE 上市公司。'
        : 'The user prefers A-share listings (SSE/SZSE). focusCompany MUST be listed on SSE or SZSE.'
      : marketHint === 'hk'
        ? isChinese
          ? '用户明确偏好港股（HKEX）。focusCompany 必须是港交所上市公司。'
          : 'The user prefers Hong Kong listings (HKEX). focusCompany MUST be listed on HKEX.'
        : marketHint === 'us'
          ? isChinese
            ? '用户明确偏好美股（NASDAQ/NYSE/AMEX）。'
            : 'The user prefers US listings (NASDAQ/NYSE/AMEX).'
          : intent.isChineseQuery
            ? isChinese
              ? '查询包含中文公司名，默认优先 A 股，其次港股，最后美股。'
              : 'The query contains Chinese text; prefer A-share, then HKEX, then US listings.'
            : '';

  const base = `The user searched for: "${query}". No direct ticker match was found.

1) Pick the single most prominent publicly traded company related to this concept as "focusCompany".
2) Pick TWO other relevant publicly traded competitors as "candidateCompanies".
${marketNote ? `- ${marketNote}\n` : ''}- Prefer the same listing market for all three companies (US / HKEX / A-share). If the concept clearly belongs to one market, keep focusCompany and both candidateCompanies on that market unless no adequate peers exist on that market.
- Only use other markets for candidateCompanies when the primary market truly lacks comparable listed peers.
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
