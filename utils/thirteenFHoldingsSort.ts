import type {
  ThirteenFHolding,
  ThirteenFHoldingSortField,
  ThirteenFSortDirection,
} from '../types/thirteenF.ts';

export const resolveHoldingWeightPct = (
  holding: Pick<ThirteenFHolding, 'portfolioWeightPct' | 'marketValueUsd'>,
  totalMarketValueUsd: number
): number => {
  if (holding.portfolioWeightPct > 0) {
    return holding.portfolioWeightPct;
  }
  if (totalMarketValueUsd <= 0) return 0;
  return (holding.marketValueUsd / totalMarketValueUsd) * 100;
};

export const sortHoldingsRows = <T extends ThirteenFHolding>(
  holdings: T[],
  sortBy: ThirteenFHoldingSortField,
  sortDir: ThirteenFSortDirection,
  totalMarketValueUsd: number
): T[] => {
  const primaryField = sortBy === 'marketValue' ? 'marketValueUsd' : 'portfolioWeightPct';

  const normalized = holdings.map(row => ({
    ...row,
    portfolioWeightPct: resolveHoldingWeightPct(row, totalMarketValueUsd),
  }));

  const sorted = [...normalized].sort((a, b) => {
    const primaryDelta =
      primaryField === 'marketValueUsd'
        ? a.marketValueUsd - b.marketValueUsd
        : a.portfolioWeightPct - b.portfolioWeightPct;

    if (primaryDelta !== 0) {
      return sortDir === 'asc' ? primaryDelta : -primaryDelta;
    }

    const tieDelta = a.marketValueUsd - b.marketValueUsd;
    return sortDir === 'asc' ? tieDelta : -tieDelta;
  });

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
};
