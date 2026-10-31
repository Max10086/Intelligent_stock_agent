import type {
  ThirteenFConsensusDirection,
  ThirteenFConsensusSector,
  ThirteenFConsensusStock,
} from '../types/thirteenF.ts';

export const CONSENSUS_LIST_PREVIEW = 6;

export const clampConsensusMinInstitutionCount = (
  minCount: number,
  selectedInstitutionCount: number
): number => {
  const normalized = Math.round(minCount);
  if (selectedInstitutionCount < 2) {
    return 2;
  }
  return Math.min(Math.max(2, normalized), selectedInstitutionCount);
};

/** Higher = stronger alignment × larger dollar move. */
export const consensusPriorityScore = (
  institutionCount: number,
  netMarketValueDeltaUsd: number
): number => institutionCount * Math.log10(Math.abs(netMarketValueDeltaUsd) + 1);

export const splitByDirection = <T extends { direction: ThirteenFConsensusDirection }>(
  items: T[]
): { buy: T[]; sell: T[] } => ({
  buy: items.filter(item => item.direction === 'BUY'),
  sell: items.filter(item => item.direction === 'SELL'),
});

export const sortStocksByPriority = (stocks: ThirteenFConsensusStock[]): ThirteenFConsensusStock[] =>
  [...stocks].sort(
    (a, b) =>
      consensusPriorityScore(b.institutionCount, b.netMarketValueDeltaUsd) -
      consensusPriorityScore(a.institutionCount, a.netMarketValueDeltaUsd)
  );

export const sortSectorsByPriority = (
  sectors: ThirteenFConsensusSector[]
): ThirteenFConsensusSector[] =>
  [...sectors].sort(
    (a, b) =>
      consensusPriorityScore(b.institutionCount, b.netMarketValueDeltaUsd) -
      consensusPriorityScore(a.institutionCount, a.netMarketValueDeltaUsd)
  );

export const topConsensusStocks = (
  stocks: ThirteenFConsensusStock[],
  direction: ThirteenFConsensusDirection,
  limit = 3
): ThirteenFConsensusStock[] =>
  sortStocksByPriority(stocks.filter(stock => stock.direction === direction)).slice(0, limit);
