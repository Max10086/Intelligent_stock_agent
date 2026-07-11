import type { CompanyProfile, Language } from '../types.ts';
import { formatMarketCapForPrompt, parseTencentMarketCapToAbsolute } from './priceFormat.ts';
import { resolveMarketCurrency, type MarketCurrency } from './marketCurrency.ts';

const WRONG_CN_SUFFIXES: Record<MarketCurrency, string[]> = {
  CNY: ['美元', '港元'],
  HKD: ['美元', '人民币'],
  USD: ['人民币', '港元'],
};

const getMarketCapYi = (marketCapRaw?: string | null): number | null => {
  const absolute = parseTencentMarketCapToAbsolute(marketCapRaw);
  if (absolute === null) return null;
  return absolute / 100_000_000;
};

const numbersLikelySameMarketCap = (mentioned: number, expectedYi: number): boolean => {
  if (!Number.isFinite(mentioned) || !Number.isFinite(expectedYi)) return false;
  if (Math.abs(mentioned - expectedYi) <= 0.25) return true;
  const relativeError = Math.abs(mentioned - expectedYi) / Math.max(expectedYi, 1);
  return relativeError <= 0.15;
};

/**
 * Fix LLM-written market-cap phrases that use the wrong currency unit for the listing.
 * e.g. A-share "312.1亿美元" → "312.1亿元人民币"
 */
export const fixMarketCapCurrencyInText = (
  text: string,
  exchange: string,
  marketCapRaw: string | undefined | null,
  lang: Language,
  verifiedLabel?: string
): string => {
  const trimmed = text.trim();
  if (!trimmed || !marketCapRaw?.trim()) return text;

  const expectedYi = getMarketCapYi(marketCapRaw);
  if (expectedYi === null) return text;

  const resolvedCurrency = resolveMarketCurrency(exchange);
  const marketCapLabel =
    verifiedLabel ||
    formatMarketCapForPrompt(marketCapRaw, lang, exchange, resolvedCurrency);

  if (lang === 'cn') {
    let result = trimmed;
    for (const wrongSuffix of WRONG_CN_SUFFIXES[resolvedCurrency]) {
      const regex = new RegExp(
        `(市值(?:约|达|为|超过)?\\s*)?(\\d+(?:\\.\\d+)?)\\s*亿${wrongSuffix}`,
        'g'
      );
      result = result.replace(regex, (match, prefix: string | undefined, num: string) => {
        const mentioned = parseFloat(num);
        if (!numbersLikelySameMarketCap(mentioned, expectedYi)) return match;
        return `${prefix || ''}${marketCapLabel}`;
      });
    }
    return result;
  }

  // English: "$31.2B USD" / "CNY 31.2B" style mismatches
  const wrongEnUnits: Record<MarketCurrency, RegExp[]> = {
    CNY: [/\bUSD\b/gi, /\bHKD\b/gi, /\bUS dollars?\b/gi],
    HKD: [/\bUSD\b/gi, /\bCNY\b/gi, /\bRMB\b/gi],
    USD: [/\bCNY\b/gi, /\bRMB\b/gi, /\bHKD\b/gi],
  };

  const enLabel = marketCapLabel;
  let result = trimmed;
  const mentionRegex = /(\$?\d+(?:\.\d+)?)\s*(trillion|billion|million|T|B|M)\b/gi;
  result = result.replace(mentionRegex, (match, _num, unit) => {
    const normalized = match.toLowerCase();
    const hasWrongUnit = wrongEnUnits[resolvedCurrency].some(pattern => pattern.test(normalized));
    if (!hasWrongUnit) return match;
    return enLabel;
  });
  return result;
};

export const sanitizeQuickTakeMarketCap = (
  text: string,
  profile: Pick<CompanyProfile, 'exchange' | 'marketCap' | 'currency'>,
  lang: Language
): string => {
  const verifiedLabel = formatMarketCapForPrompt(
    profile.marketCap,
    lang,
    profile.exchange,
    profile.currency
  );
  return fixMarketCapCurrencyInText(
    text,
    profile.exchange,
    profile.marketCap,
    lang,
    verifiedLabel
  );
};
