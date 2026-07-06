import type { CompanyProfile, Language } from '../types.ts';
import { getEquityMarket } from './companyDiscovery.ts';

export type CompanyIdentityProfile = Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>;

const MARKET_LABEL: Record<'US' | 'HK' | 'CN', { cn: string; en: string }> = {
  US: { cn: '美国（NASDAQ / NYSE / AMEX）', en: 'United States (NASDAQ / NYSE / AMEX)' },
  HK: { cn: '香港（HKEX）', en: 'Hong Kong (HKEX)' },
  CN: { cn: '中国大陆 A 股（SSE / SZSE）', en: 'mainland China A-share (SSE / SZSE)' },
};

/** Known ticker / name collisions where web search often returns the wrong issuer. */
const TICKER_COLLISION_REGISTRY: Record<
  string,
  {
    canonicalNameHint: string;
    excludeNamePatterns: RegExp[];
    excludeTopicPatterns: RegExp[];
    searchBoostTerms: string[];
  }
> = {
  IREN: {
    canonicalNameHint: 'Iris Energy Limited',
    excludeNamePatterns: [
      /gruppo\s+iren/i,
      /\bIRE\.MI\b/i,
      /borsa\s+italian/i,
      /euronext\s+milan/i,
      /multi.?utility/i,
      /utilities?\s+group/i,
    ],
    excludeTopicPatterns: [
      /water\s+utility|waste\s+(management|treatment)|gas\s+distribution|district\s+heating/i,
      /circular\s+economy.*2030|industrial\s+symbiosis|EU\s+Innovation\s+Fund/i,
      /水务|燃气|废物处理|公用事业集团|循环经济.*2030|工业共生|欧盟创新基金/i,
    ],
    searchBoostTerms: ['Iris Energy', 'NASDAQ IREN', 'bitcoin mining', 'HPC data center'],
  },
};

const FOREIGN_EXCHANGE_HINTS =
  /borsa\s+italian|euronext|london\s+stock|deutsche\s+börse|six\s+swiss|tmx|toronto\s+stock|港交所|上交所|深交所/i;

const looksLikeTickerQuery = (query: string): boolean => /^[A-Za-z0-9.\-]{1,10}$/.test(query.trim());

export const getTickerCollisionHints = (ticker: string) =>
  TICKER_COLLISION_REGISTRY[ticker.toUpperCase()] || null;

export const buildCompanyIdentityBlock = (
  profile: CompanyIdentityProfile,
  lang: Language = 'en'
): string => {
  const market = getEquityMarket(profile);
  const marketLabel = market ? MARKET_LABEL[market][lang] : profile.exchange;
  const collision = getTickerCollisionHints(profile.ticker);

  if (lang === 'cn') {
    const collisionNote = collision
      ? `\n- 易混淆提示：股票代码 ${profile.ticker} 在全球可能对应其他公司；本次分析锁定「${profile.name}」（${collision.canonicalNameHint}），禁止混入其他同名/同代码实体。`
      : '';
    return `【分析目标公司 — 唯一身份锚点】
- 法定分析对象：${profile.name}
- 股票代码：${profile.ticker}
- 上市交易所：${profile.exchange}
- 上市市场：${marketLabel}${collisionNote}
- 后续所有搜索、问答、结论必须仅针对上述实体；禁止替换为同名、同代码或名称相近的其他上市公司。`;
  }

  const collisionNote = collision
    ? `\n- Collision warning: ticker ${profile.ticker} may match other listed issuers globally. This analysis is locked to "${profile.name}" (${collision.canonicalNameHint}) — do NOT mix in other namesakes.`
    : '';
  return `[TARGET COMPANY — sole identity anchor]
- Issuer under analysis: ${profile.name}
- Ticker: ${profile.ticker}
- Exchange: ${profile.exchange}
- Listing market: ${marketLabel}${collisionNote}
- All search, Q&A, and conclusions MUST refer ONLY to this exact listed entity — never substitute a namesake or same-ticker issuer on another exchange.`;
};

export const buildSearchDisambiguationBlock = (
  profile: CompanyIdentityProfile,
  lang: Language = 'en'
): string => {
  const queries = buildSuggestedSearchQueries(profile);
  const collision = getTickerCollisionHints(profile.ticker);

  if (lang === 'cn') {
    const excludeBlock = collision
      ? `\n必须排除的误匹配对象/主题：
${collision.excludeNamePatterns.map(() => `- 名称/代码含 Gruppo Iren、IRE.MI、意大利 Borsa 等（当目标为 ${profile.name} / ${profile.exchange} 时）`).join('\n')}
- 意大利公用事业（水务/燃气/废物）、欧盟公用事业 2030 商业计划等，若与 ${profile.name} 主营业务不符，一律视为误匹配。`
      : '';
    return `【搜索消歧规则 — 必须遵守】
1. 搜索时优先使用：${queries.map(q => `「${q}」`).join('、')}。
2. 仅采用与 ${profile.name}（${profile.ticker} / ${profile.exchange}）一致的信息；忽略其他交易所、其他国家同名公司。
3. 若搜索结果指向不同交易所/不同主营业务的公司，视为无效，不得写入答案。${excludeBlock}
4. 引用事实时注明报告期；若来源未明确指向 ${profile.ticker}（${profile.exchange}），不得采用。`;
  }

  const excludeBlock = collision
    ? `\nEntities/topics to REJECT as wrong-company matches:
- Names/codes such as Gruppo Iren, IRE.MI, Borsa Italiana when the target is ${profile.name} on ${profile.exchange}.
- Italian utility / water / gas / waste narratives unless they clearly match ${profile.name}'s verified business.`
    : '';
  return `[SEARCH DISAMBIGUATION — mandatory]
1. Prefer search queries: ${queries.map(q => `"${q}"`).join(', ')}.
2. Use ONLY information about ${profile.name} (${profile.ticker} / ${profile.exchange}); ignore namesakes on other exchanges.
3. If a result points to a different exchange or unrelated business, treat it as invalid — do NOT include it in the answer.${excludeBlock}
4. Every material fact must clearly apply to ${profile.ticker} on ${profile.exchange}; otherwise discard it.`;
};

export const buildSuggestedSearchQueries = (profile: CompanyIdentityProfile): string[] => {
  const collision = getTickerCollisionHints(profile.ticker);
  const base = [
    `${profile.name} ${profile.ticker} ${profile.exchange}`,
    `${profile.ticker} ${profile.exchange} stock`,
  ];
  if (collision) {
    for (const term of collision.searchBoostTerms) {
      base.push(`${term} ${profile.ticker}`);
    }
  }
  return Array.from(new Set(base.filter(Boolean)));
};

export const buildWrongCompanyRetryAppendix = (
  profile: CompanyIdentityProfile,
  lang: Language,
  reasons: string[]
): string => {
  const reasonList = reasons.map(r => `- ${r}`).join('\n');
  if (lang === 'cn') {
    return `

【严重错误 — 必须重写】
上一版答案疑似混入了其他公司（${reasonList}）。
请完全重写，且仅基于 ${profile.name}（${profile.ticker} / ${profile.exchange}）。
${buildSearchDisambiguationBlock(profile, lang)}`;
  }
  return `

[CRITICAL ERROR — rewrite required]
The previous draft likely mixed in a different company (${reasonList}).
Rewrite using ONLY ${profile.name} (${profile.ticker} / ${profile.exchange}).
${buildSearchDisambiguationBlock(profile, lang)}`;
};

export const detectWrongCompanyMix = (
  answer: string,
  profile: CompanyIdentityProfile
): { mixed: boolean; reasons: string[] } => {
  const text = (answer || '').trim();
  if (!text) return { mixed: false, reasons: [] };

  const reasons: string[] = [];
  const focusMarket = getEquityMarket(profile);
  const collision = getTickerCollisionHints(profile.ticker);

  if (collision) {
    for (const pattern of [...collision.excludeNamePatterns, ...collision.excludeTopicPatterns]) {
      if (pattern.test(text)) {
        reasons.push(`matched exclusion pattern: ${pattern.source}`);
      }
    }
  }

  const foreignTickerHits =
    text.match(/\b[A-Z]{1,5}\.(MI|L|PA|DE|SW|AS|TO|V|ST|HE|OL|CO|SA|MX|KS|T|HK|SS|SZ)\b/gi) || [];
  for (const hit of foreignTickerHits) {
    const upper = hit.toUpperCase();
    if (upper.startsWith(`${profile.ticker.toUpperCase()}.`)) {
      reasons.push(`foreign listing code ${hit} conflicts with ${profile.exchange} focus`);
    }
  }

  if (focusMarket === 'US' && FOREIGN_EXCHANGE_HINTS.test(text)) {
    const mentionsForeignOnly =
      /borsa\s+italian|euronext\s+milan|\bIRE\.MI\b|gruppo\s+iren/i.test(text) &&
      !new RegExp(profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
    if (mentionsForeignOnly) {
      reasons.push('answer cites foreign exchange / Italian issuer without anchoring on target name');
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return { mixed: uniqueReasons.length > 0, reasons: uniqueReasons };
};

/** Rank Yahoo Finance search hits — higher is better. */
export const scoreYahooFinanceQuote = (
  intent: { cleanQuery: string; preferredMarkets: import('./searchQueryIntent.ts').EquityMarketPref[] },
  quote: { symbol?: string; exchange?: string; exchDisp?: string; quoteType?: string; typeDisp?: string },
  marketPrefRank: (exchange: string, preferredMarkets: import('./searchQueryIntent.ts').EquityMarketPref[]) => number
): number => {
  const symbol = (quote.symbol || '').toString().trim().toUpperCase();
  const exchange = quote.exchange || quote.exchDisp || '';
  const query = intent.cleanQuery.trim().toUpperCase();
  let score = marketPrefRank(exchange, intent.preferredMarkets);

  if (looksLikeTickerQuery(intent.cleanQuery)) {
    const baseSymbol = symbol.split('.')[0];
    if (baseSymbol === query) score += 200;
    if (symbol.includes('.') && intent.preferredMarkets[0] === 'us') score -= 100;
    if (baseSymbol !== query && symbol.length <= 6) score -= 40;
  }

  const type = (quote.quoteType || quote.typeDisp || '').toString().toUpperCase();
  if (type === 'EQUITY') score += 15;

  return score;
};

export const buildQuickTakeIdentityRule = (
  profile: CompanyIdentityProfile,
  lang: Language
): string => {
  const collision = getTickerCollisionHints(profile.ticker);
  if (!collision) return '';
  if (lang === 'cn') {
    return `8) 仅描述 ${profile.name}（${profile.ticker} / ${profile.exchange}）；禁止写入 Gruppo Iren、IRE.MI 等易混淆实体或其公用事业业务。`;
  }
  return `8) Describe ONLY ${profile.name} (${profile.ticker} / ${profile.exchange}); do NOT describe namesakes such as Gruppo Iren / IRE.MI or unrelated utility businesses.`;
};
