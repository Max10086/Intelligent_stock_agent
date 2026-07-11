export type MarketCurrency = 'CNY' | 'HKD' | 'USD';

const A_SHARE_EXCHANGES = new Set(['SSE', 'SZSE', 'SH', 'SZ', 'A-SHARE', 'ASHARE']);
const HK_EXCHANGES = new Set(['HKEX', 'HK', 'HKG']);
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'US', 'ARCA', 'BATS', 'OTC']);

/** Normalize raw currency hints (ISO codes and common aliases). */
export const normalizeCurrencyCode = (raw?: string | null): MarketCurrency | null => {
  const trimmed = (raw || '').trim().toUpperCase();
  if (!trimmed) return null;

  if (trimmed === 'RMB' || trimmed === 'CNH' || trimmed === 'CNY' || trimmed === '人民币') {
    return 'CNY';
  }
  if (trimmed === 'HKD' || trimmed === 'HK' || trimmed === '港元' || trimmed === '港币') {
    return 'HKD';
  }
  if (trimmed === 'USD' || trimmed === 'US' || trimmed === '美元') {
    return 'USD';
  }

  if (/^[A-Z]{3}$/.test(trimmed)) {
    if (trimmed === 'CNY' || trimmed === 'HKD' || trimmed === 'USD') {
      return trimmed;
    }
  }

  return null;
};

/** Resolve listing currency from exchange first, then optional quote currency. */
export const resolveMarketCurrency = (
  exchange: string,
  currency?: string | null
): MarketCurrency => {
  const ex = exchange.trim().toUpperCase();
  if (A_SHARE_EXCHANGES.has(ex)) return 'CNY';
  if (HK_EXCHANGES.has(ex)) return 'HKD';
  if (US_EXCHANGES.has(ex)) return 'USD';

  const fromQuote = normalizeCurrencyCode(currency);
  if (fromQuote) return fromQuote;

  return 'USD';
};

export const marketCurrencyLabel = (currency: MarketCurrency, lang: 'en' | 'cn'): string => {
  if (lang === 'cn') {
    if (currency === 'CNY') return '人民币';
    if (currency === 'HKD') return '港元';
    return '美元';
  }
  return currency;
};
