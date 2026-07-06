import type { CompanyProfile, Language } from '../types.ts';
import { formatDisplayPrice, formatMarketCapForPrompt } from './priceFormat.ts';
import {
  buildCompanyIdentityBlock,
  buildSearchDisambiguationBlock,
  buildSuggestedSearchQueries,
} from './companyIdentity.ts';

/** Authoritative quote snapshot from getFinancialData — inject into LLM prompts. */
export const buildVerifiedMarketContext = (
  profile: Pick<
    CompanyProfile,
    'name' | 'ticker' | 'exchange' | 'currentPrice' | 'peTtm' | 'marketCap' | 'currency' | 'quoteTime'
  >,
  lang: Language = 'en'
): string => {
  const identityBlock = buildCompanyIdentityBlock(profile, lang);
  const price = formatDisplayPrice(profile.currentPrice, profile.exchange);
  const quoteTime = profile.quoteTime?.trim() || '';
  const pe = profile.peTtm?.trim() || 'N/A';
  const marketCap = formatMarketCapForPrompt(profile.marketCap, lang, profile.currency);
  const currency = profile.currency?.trim() || '';

  if (lang === 'cn') {
    return `${identityBlock}

【系统已验证行情快照 — 「当前股价/估值」必须以此为准】
- 公司：${profile.name}（${profile.ticker} / ${profile.exchange}）
- 当前股价：${price}${currency ? ` ${currency}` : ''}${quoteTime ? `（行情时间 ${quoteTime}）` : ''}
- 市盈率 TTM：${pe}
- 总市值：${marketCap}（引用市值时必须使用此数值，禁止自行换算或改写）

行情硬性规则（违反即为严重错误）：
1. 凡写「当前股价」「现价」「当前价位」「当前估值」「P/E」「市销率」等，必须使用上述已验证价格与倍数；不得从搜索摘取其他数字当作现价。
2. 搜索若出现与现价差异极大的价格（常见：拆股/合股前历史价、旧新闻、误匹配其他代码），只能作为「历史价格」引用，须标注日期/是否拆股前；禁止当作当前价。
3. 禁止将拆股前低价（如 $0.5x）与拆股后现价（如 $24）混用或暗示公司仍在「几毛钱」价位交易。`;
  }

  return `${identityBlock}

[VERIFIED MARKET SNAPSHOT — use as the ONLY source for "current price" / valuation]
- Company: ${profile.name} (${profile.ticker} / ${profile.exchange})
- Current price: ${price}${currency ? ` ${currency}` : ''}${quoteTime ? ` (as of ${quoteTime})` : ''}
- PE (TTM): ${pe}
- Market cap: ${marketCap} (use this figure verbatim when citing market cap — do NOT recalculate)

PRICE RULES (violations are critical errors):
1. Any mention of "current price", "trading at", "current valuation", P/E, P/S, etc. MUST use the verified figures above — not numbers from web search alone.
2. If search returns a very different price (common: pre-reverse-split history, stale articles, wrong ticker), cite it ONLY as historical with date/split context — never as the current price.
3. Do NOT mix pre-split prices (e.g. ~$0.50) with post-split current prices (e.g. ~$24) or imply the stock still trades near the old level.`;
};

export const buildAnswerQuestionPrompt = (
  question: string,
  profile: Pick<
    CompanyProfile,
    'name' | 'ticker' | 'exchange' | 'currentPrice' | 'peTtm' | 'marketCap' | 'currency' | 'quoteTime'
  >,
  outputLanguage: string,
  recencyGuidance: string,
  lang: Language
): string => {
  const marketContext = buildVerifiedMarketContext(profile, lang);
  const disambiguation = buildSearchDisambiguationBlock(profile, lang);
  const searchHints = buildSuggestedSearchQueries(profile);
  const isChinese = lang === 'cn';

  if (isChinese) {
    return `${marketContext}

${disambiguation}

作为金融分析师，请用简体中文回答关于「${profile.name}」（${profile.ticker} / ${profile.exchange}）的以下问题：「${question}」
${recencyGuidance}
回答要求：
- 涉及股价/估值时，以「系统已验证行情快照」为当前价基准；搜索中的冲突价格须标注为历史并注明日期。
- 搜索时请使用含交易所的查询，例如：${searchHints.slice(0, 3).join('；')}。
- 优先使用最新可得数据，旧数据仅作对比参考。
- 若无法获取最新披露/期间数据，须明确说明限制。
- 关键事实须标注期间（如 YYYY-Qx、YYYY 年报、YYYY-MM）。
- 引用信息来源；若来源指向其他同名/同代码公司，必须丢弃。`;
  }

  return `${marketContext}

${disambiguation}

As a financial analyst, answer this question about "${profile.name}" (${profile.ticker} / ${profile.exchange}) in ${outputLanguage}: "${question}".
${recencyGuidance}
Answer requirements:
- For price/valuation, anchor on the VERIFIED MARKET SNAPSHOT; conflicting search prices must be labeled historical with dates.
- Prefer search queries that include the exchange, e.g.: ${searchHints.slice(0, 3).join('; ')}.
- Use freshest available data first; older data is secondary context only.
- If the latest filing/period is unavailable, clearly disclose that limitation.
- For key facts, include period labels (e.g. YYYY-Qx, YYYY annual report, YYYY-MM).
- Cite sources; discard any source that refers to a namesake or same-ticker issuer on another exchange.`;
};
