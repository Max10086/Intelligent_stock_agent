import type { CatalogReturnDisplay } from '../types/catalogReturn.ts';
import { parsePriceNumber } from './priceFormat.ts';
import type { ConclusionCategory } from './conclusionCategory.ts';

export type CatalogWinRateItem = {
  id: string;
  currentPrice?: string | null;
};

export type CatalogCategoryWinRate = {
  winCount: number;
  totalCount: number;
  winRatePct: number | null;
  /** Items with a resolved cumulative return. */
  scoredCount: number;
  /** All items in the category have finished loading cumulative returns. */
  ready: boolean;
};

export const isCatalogCumulativeReturnEligible = (item: CatalogWinRateItem): boolean =>
  Boolean(item.currentPrice && parsePriceNumber(item.currentPrice));

export const isCatalogItemReturnResolved = (
  item: CatalogWinRateItem,
  returnsById: Record<string, CatalogReturnDisplay>
): boolean => {
  const display = returnsById[item.id];
  if (!display) {
    return !isCatalogCumulativeReturnEligible(item);
  }
  return display.status !== 'loading';
};

export const isCatalogCategoryReturnsReady = (
  items: CatalogWinRateItem[],
  returnsById: Record<string, CatalogReturnDisplay>
): boolean => items.every(item => isCatalogItemReturnResolved(item, returnsById));

export const isSellSideCatalogCategory = (category: ConclusionCategory): boolean =>
  category === 'sell';

export const isCatalogCategoryWin = (
  returnPct: number,
  category: ConclusionCategory
): boolean => {
  if (isSellSideCatalogCategory(category)) {
    return returnPct < 0;
  }
  return returnPct > 0;
};

export const computeCatalogCategoryWinRate = (
  items: CatalogWinRateItem[],
  returnsById: Record<string, CatalogReturnDisplay>,
  category: ConclusionCategory
): CatalogCategoryWinRate => {
  const totalCount = items.length;
  const ready = isCatalogCategoryReturnsReady(items, returnsById);

  if (totalCount === 0) {
    return { winCount: 0, totalCount: 0, winRatePct: null, scoredCount: 0, ready: true };
  }

  if (!ready) {
    return { winCount: 0, totalCount, winRatePct: null, scoredCount: 0, ready: false };
  }

  let winCount = 0;
  let scoredCount = 0;

  for (const item of items) {
    const display = returnsById[item.id];
    if (
      display?.status !== 'done' ||
      display.returnPct == null ||
      !Number.isFinite(display.returnPct)
    ) {
      continue;
    }
    scoredCount += 1;
    if (isCatalogCategoryWin(display.returnPct, category)) {
      winCount += 1;
    }
  }

  return {
    winCount,
    totalCount,
    winRatePct: (winCount / totalCount) * 100,
    scoredCount,
    ready: true,
  };
};

export const formatCatalogWinRateLabel = (
  stats: CatalogCategoryWinRate,
  loadingLabel: string
): string | null => {
  if (stats.totalCount === 0) return null;
  if (!stats.ready) return loadingLabel;
  const pct = stats.winRatePct ?? 0;
  const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
  return `${pctText}%(${stats.winCount}/${stats.totalCount})`;
};
