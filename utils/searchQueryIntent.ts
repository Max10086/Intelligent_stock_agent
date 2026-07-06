export type EquityMarketPref = 'cn' | 'hk' | 'us';

export interface ParsedSearchQuery {
  original: string;
  cleanQuery: string;
  preferredMarkets: EquityMarketPref[];
  isChineseQuery: boolean;
  aShareCode?: string;
  hkCode?: string;
}

const MARKET_HINT_PATTERNS: Array<{ pattern: RegExp; market: EquityMarketPref }> = [
  { pattern: /A股|A\s*share|A-shares?|ashares?/gi, market: 'cn' },
  { pattern: /上交所|深交所|沪A|深A|上证|深证/gi, market: 'cn' },
  { pattern: /港股|HK股|HKEX|香港(?:上市|股票)?/gi, market: 'hk' },
  { pattern: /美股|US\s*stock|NASDAQ|NYSE|AMEX/gi, market: 'us' },
];

const stripMarketHints = (query: string): { text: string; markets: EquityMarketPref[] } => {
  const markets: EquityMarketPref[] = [];
  let text = query;
  for (const { pattern, market } of MARKET_HINT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      if (!markets.includes(market)) markets.push(market);
      pattern.lastIndex = 0;
      text = text.replace(pattern, ' ');
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), markets };
};

const extractListingCodes = (
  query: string
): { cleanQuery: string; aShareCode?: string; hkCode?: string } => {
  let cleanQuery = query;

  const hkMatch = cleanQuery.match(/\b(0\d{4})\.HK\b/i) || cleanQuery.match(/\bHK\s*(0\d{4})\b/i);
  const hkCode = hkMatch?.[1];
  if (hkCode) cleanQuery = cleanQuery.replace(hkMatch![0], ' ').replace(/\s+/g, ' ').trim();

  const aShareMatch =
    cleanQuery.match(/\b([0-9]{6})\.(?:SH|SS|SZ)\b/i) ||
    cleanQuery.match(/\b(?:SH|SZ)\s*([0-9]{6})\b/i);
  const aShareCode = aShareMatch?.[1] || cleanQuery.match(/\b([0-9]{6})\b/)?.[1];
  if (aShareCode) {
    cleanQuery = cleanQuery.replace(aShareCode, ' ').replace(/\s+/g, ' ').trim();
  }

  return { cleanQuery, aShareCode, hkCode };
};

export const parseSearchQuery = (raw: string): ParsedSearchQuery => {
  const original = raw.trim();
  const { text: afterHints, markets: hintedMarkets } = stripMarketHints(original);
  const { cleanQuery, aShareCode, hkCode } = extractListingCodes(afterHints);
  const isChineseQuery = /[\u4e00-\u9fff]/.test(cleanQuery || original);

  let preferredMarkets = [...hintedMarkets];
  if (aShareCode && !preferredMarkets.includes('cn')) preferredMarkets.unshift('cn');
  if (hkCode && !preferredMarkets.includes('hk')) preferredMarkets.unshift('hk');

  if (preferredMarkets.length === 0) {
    preferredMarkets = isChineseQuery ? ['cn', 'hk', 'us'] : ['us', 'hk', 'cn'];
  }

  return {
    original,
    cleanQuery: cleanQuery || original,
    preferredMarkets,
    isChineseQuery,
    aShareCode,
    hkCode,
  };
};

export const exchangeToMarketPref = (exchange: string): EquityMarketPref | null => {
  const ex = exchange.toUpperCase();
  if (['SSE', 'SZSE', 'SH', 'SZ'].includes(ex)) return 'cn';
  if (['HKEX', 'HK'].includes(ex)) return 'hk';
  if (['NASDAQ', 'NYSE', 'AMEX', 'US'].includes(ex)) return 'us';
  return null;
};

export const marketPrefRank = (
  exchange: string,
  preferredMarkets: EquityMarketPref[]
): number => {
  const market = exchangeToMarketPref(exchange);
  if (!market) return 0;
  const index = preferredMarkets.indexOf(market);
  if (index === -1) return 0;
  return (preferredMarkets.length - index) * 30;
};

export const prefixOrderForMarkets = (preferredMarkets: EquityMarketPref[]): string[] => {
  const map: Record<EquityMarketPref, string> = { cn: 'sh', hk: 'hk', us: 'us' };
  const prefixes: string[] = [];
  for (const market of preferredMarkets) {
    if (market === 'cn') {
      prefixes.push('sh', 'sz');
    } else {
      prefixes.push(map[market]);
    }
  }
  for (const fallback of ['sh', 'sz', 'hk', 'us']) {
    if (!prefixes.includes(fallback)) prefixes.push(fallback);
  }
  return prefixes;
};
