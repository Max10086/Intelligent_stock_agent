import { getQuotePrice, searchTicker } from '../../services/finance.js';
import { computeReturnPct } from '../../utils/priceFormat.js';
import type {
  CatalogReturnInputItem,
  CatalogReturnResultItem,
} from '../../types/catalogReturn.ts';

const looksLikeTicker = (value: string): boolean => /^[A-Za-z0-9.\-]{1,10}$/.test(value.trim());

const tryQuotePrice = async (ticker: string, exchange: string): Promise<string | null> => {
  try {
    return await getQuotePrice({ ticker, exchange });
  } catch (error) {
    console.warn(
      `[catalogReturn] Failed to fetch price for ${ticker}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

const fetchLivePrice = async (item: CatalogReturnInputItem): Promise<string | null> => {
  const exchange = item.exchange || 'NASDAQ';

  if (looksLikeTicker(item.ticker)) {
    const direct = await tryQuotePrice(item.ticker, exchange);
    if (direct) return direct;
  }

  const query = item.companyName?.trim() || item.ticker.trim();
  if (!query) return null;

  try {
    const resolved = await searchTicker(query);
    if (!resolved?.ticker) return null;
    return await tryQuotePrice(resolved.ticker, resolved.exchange || exchange);
  } catch (error) {
    console.warn(
      `[catalogReturn] Failed to resolve ticker for ${query}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

/** Baseline = analysis-day price; return = change vs latest quote (same as return tracking). */
export const computeCatalogReturns = async (
  items: CatalogReturnInputItem[]
): Promise<CatalogReturnResultItem[]> => {
  const results = await Promise.all(
    items.map(async item => {
      const anchorPrice = item.anchorPrice?.trim() || '';
      if (!anchorPrice) {
        return { id: item.id, returnPct: null, currentPrice: null };
      }

      const currentPrice = await fetchLivePrice(item);
      if (!currentPrice) {
        return { id: item.id, returnPct: null, currentPrice: null };
      }

      return {
        id: item.id,
        currentPrice,
        returnPct: computeReturnPct(anchorPrice, currentPrice),
      };
    })
  );

  return results;
};
