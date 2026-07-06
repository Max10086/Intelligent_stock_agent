export const parsePriceNumber = (price: string | undefined | null): number | null => {
  const parsed = Number((price || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Tencent quote fields [44]/[45] report market cap in hundred-millions (亿).
 * e.g. CRDO total cap raw "451.1" → 45.11B USD absolute.
 */
export const parseTencentMarketCapToAbsolute = (value?: string | null): number | null => {
  const parsed = parseFloat((value || '').replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 1_000_000 ? parsed * 100_000_000 : parsed;
};

/** Human-readable market cap for UI (e.g. "45.11B USD"). */
export const formatMarketCapDisplay = (
  value?: string | null,
  currency?: string
): string => {
  const normalizedAmount = parseTencentMarketCapToAbsolute(value);
  if (normalizedAmount === null) return 'N/A';

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

  if (currency && /^[A-Z]{3}$/.test(currency)) {
    return `${display} ${currency}`;
  }
  return display;
};

/** Market cap phrasing for LLM prompts — matches the UI conversion logic. */
export const formatMarketCapForPrompt = (
  value: string | undefined | null,
  lang: 'en' | 'cn',
  currency?: string
): string => {
  const normalizedAmount = parseTencentMarketCapToAbsolute(value);
  if (normalizedAmount === null) return lang === 'cn' ? '未知' : 'N/A';

  const resolvedCurrency =
    currency && /^[A-Z]{3}$/.test(currency)
      ? currency
      : currency === 'CNY' || currency === 'HKD'
        ? currency
        : 'USD';

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

  return formatMarketCapDisplay(value, resolvedCurrency);
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
  const currency =
    exchange === 'HKEX' ? 'HKD' : exchange === 'SSE' || exchange === 'SZSE' ? 'CNY' : 'USD';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parsed);
};
