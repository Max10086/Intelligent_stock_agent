import {
  marketCurrencyLabel,
  resolveMarketCurrency,
  type MarketCurrency,
} from './marketCurrency.ts';

export const parsePriceNumber = (price: string | undefined | null): number | null => {
  const parsed = Number((price || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Tencent quote fields [44]/[45] report market cap in hundred-millions (亿).
 * e.g. raw "312.0" on an A-share → ¥31.2B absolute (312亿元人民币).
 */
export const parseTencentMarketCapToAbsolute = (value?: string | null): number | null => {
  const parsed = parseFloat((value || '').replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 1_000_000 ? parsed * 100_000_000 : parsed;
};

/** Human-readable market cap for UI (e.g. "31.20B CNY"). */
export const formatMarketCapDisplay = (
  value?: string | null,
  exchange?: string,
  currency?: string
): string => {
  const normalizedAmount = parseTencentMarketCapToAbsolute(value);
  if (normalizedAmount === null) return 'N/A';

  const resolvedCurrency = resolveMarketCurrency(exchange || '', currency);

  let display = '';
  if (normalizedAmount >= 1_000_000_000_000) {
    display = `${(normalizedAmount / 1_000_000_000_000).toFixed(2)}T`;
  } else if (normalizedAmount >= 1_000_000_000) {
    display = `${(normalizedAmount / 1_000_000_000).toFixed(2)}B`;
  } else if (normalizedAmount >= 1_000_000) {
    display = `${(normalizedAmount / 1_000_000).toFixed(2)}M`;
  } else {
    display = normalizedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  return `${display} ${resolvedCurrency}`;
};

/** Market cap phrasing for LLM prompts — matches the UI conversion logic. */
export const formatMarketCapForPrompt = (
  value: string | undefined | null,
  lang: 'en' | 'cn',
  exchange: string,
  currency?: string
): string => {
  const normalizedAmount = parseTencentMarketCapToAbsolute(value);
  if (normalizedAmount === null) return lang === 'cn' ? '未知' : 'N/A';

  const resolvedCurrency = resolveMarketCurrency(exchange, currency);

  if (lang === 'cn') {
    const yi = normalizedAmount / 100_000_000;
    if (resolvedCurrency === 'CNY') {
      return `${yi.toFixed(1)}亿元人民币`;
    }
    if (resolvedCurrency === 'HKD') {
      return `${yi.toFixed(1)}亿港元`;
    }
    return `${yi.toFixed(1)}亿美元`;
  }

  return formatMarketCapDisplay(value, exchange, resolvedCurrency);
};

export const buildMarketCapPromptRule = (
  marketCapLabel: string,
  exchange: string,
  currency: MarketCurrency,
  lang: 'en' | 'cn'
): string => {
  const currencyName = marketCurrencyLabel(currency, lang);
  if (lang === 'cn') {
    return `7) 若提及市值规模，必须原样使用「${marketCapLabel}」（${exchange}，计价货币：${currencyName}），禁止自行换算、缩放、改写数字，禁止将人民币市值写成美元或港元。`;
  }
  return `7) If mentioning market cap, use exactly "${marketCapLabel}" (${exchange}, currency: ${currency}) — do NOT recalculate, rescale, or swap CNY/HKD/USD units.`;
};

export const computeReturnPct = (anchorPrice: string, currentPrice: string): number | null => {
  const base = parsePriceNumber(anchorPrice);
  const curr = parsePriceNumber(currentPrice);
  if (base === null || curr === null || base === 0) return null;
  return ((curr - base) / base) * 100;
};

export const formatReturnPct = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

export const formatDisplayPrice = (
  price: string | undefined | null,
  exchange?: string
): string => {
  const parsed = parsePriceNumber(price);
  if (parsed === null) return 'N/A';
  const currency = resolveMarketCurrency(exchange || '');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parsed);
};
