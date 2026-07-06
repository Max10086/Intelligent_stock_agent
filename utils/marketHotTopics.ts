import type { EquityMarket, MarketHotTopicsSnapshot, MarketTheme } from '../types/compare.ts';
import type { Language } from '../types.ts';
import { tryParseModelJson } from './modelJson.ts';

const MARKET_LABELS: Record<EquityMarket, { en: string; cn: string }> = {
  US: {
    en: 'US stock market (NASDAQ, NYSE, AMEX)',
    cn: '美股市场（NASDAQ、NYSE、AMEX）',
  },
  HK: {
    en: 'Hong Kong stock market (HKEX)',
    cn: '港股市场（HKEX）',
  },
  CN: {
    en: 'mainland China A-share market (SSE, SZSE)',
    cn: 'A股市场（上交所、深交所）',
  },
};

export const buildMarketHotTopicsSearchPrompt = (
  market: EquityMarket,
  language: Language
): string => {
  const label = MARKET_LABELS[market][language === 'cn' ? 'cn' : 'en'];
  const dateHint = new Date().toISOString().slice(0, 10);

  if (language === 'cn') {
    return `请检索「${label}」在 ${dateHint} 前后**当前**最热门的投资主题、板块概念与关键词（5–10 个）。

要求：
- 聚焦**当下**资金与叙事焦点，不要罗列已充分 price-in 的旧主题
- 每个主题给出 2–5 个 keywords 与 1 句 brief
- 返回 ONLY valid JSON：
{
  "themes": [
    { "name": "主题名", "keywords": ["kw1", "kw2"], "brief": "为何当前热门" }
  ]
}`;
  }

  return `Search for the **current** hottest investment themes, sector narratives, and keywords in the ${label} as of ${dateHint}.

Requirements:
- Focus on what capital and narrative focus on **now**, not stale priced-in themes
- 5–10 themes; each with 2–5 keywords and a 1-sentence brief
- Return ONLY valid JSON:
{
  "themes": [
    { "name": "Theme name", "keywords": ["kw1", "kw2"], "brief": "Why hot now" }
  ]
}`;
};

export const buildMarketHotTopicsSearchQuery = (
  market: EquityMarket,
  language: Language
): string => {
  const dateHint = new Date().toISOString().slice(0, 7);
  if (language === 'cn') {
    if (market === 'US') return `${dateHint} 美股 当前 热门 板块 概念 投资主题`;
    if (market === 'HK') return `${dateHint} 港股 当前 热门 板块 概念 投资主题`;
    return `${dateHint} A股 当前 热门 板块 概念 投资主题`;
  }
  if (market === 'US') return `${dateHint} US stock market hot themes sectors concepts`;
  if (market === 'HK') return `${dateHint} Hong Kong stock market hot themes sectors`;
  return `${dateHint} China A-share hot themes sectors concepts`;
};

const normalizeTheme = (raw: unknown): MarketTheme | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return null;
  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((k): k is string => typeof k === 'string' && Boolean(k.trim()))
        .map(k => k.trim())
        .slice(0, 5)
    : [];
  const brief = typeof record.brief === 'string' ? record.brief.trim() : '';
  return { name, keywords, brief: brief || name };
};

export const parseMarketHotTopicsResponse = (
  rawText: string,
  market: EquityMarket,
  searchQuery: string
): MarketHotTopicsSnapshot['markets'][EquityMarket] => {
  const parsed = (tryParseModelJson(rawText) || {}) as Record<string, unknown>;
  const themesRaw = Array.isArray(parsed.themes) ? parsed.themes : [];
  const themes = themesRaw.map(normalizeTheme).filter(Boolean) as MarketTheme[];

  return {
    themes: themes.slice(0, 10),
    searchQuery,
  };
};

export const emptyHotTopicsSnapshot = (): MarketHotTopicsSnapshot => ({
  fetchedAt: new Date().toISOString(),
  markets: {},
});

export { MARKET_LABELS };
