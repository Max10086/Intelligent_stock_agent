import type {
  ThirteenFPositionChange,
  ThirteenFPositionChangeCategory,
} from '../types/thirteenF.ts';

export const emptyChangeCounts = (): Record<ThirteenFPositionChangeCategory, number> => ({
  NEW: 0,
  ADD: 0,
  REDUCE: 0,
  CLEAR: 0,
});

export const computeChangeCounts = (
  changes: Array<Pick<ThirteenFPositionChange, 'category'>>
): Record<ThirteenFPositionChangeCategory, number> => {
  const counts = emptyChangeCounts();
  for (const change of changes) {
    counts[change.category] += 1;
  }
  return counts;
};

export const sumChangeCounts = (
  counts: Record<ThirteenFPositionChangeCategory, number>
): number => counts.NEW + counts.ADD + counts.REDUCE + counts.CLEAR;

export const isChangeCountsTruncated = (
  displayed: Record<ThirteenFPositionChangeCategory, number>,
  total?: Record<ThirteenFPositionChangeCategory, number> | null
): boolean => {
  if (!total) return false;
  return (
    total.NEW > displayed.NEW ||
    total.ADD > displayed.ADD ||
    total.REDUCE > displayed.REDUCE ||
    total.CLEAR > displayed.CLEAR
  );
};

export const formatChangesTruncatedHint = (
  template: string,
  limit: number,
  total: Record<ThirteenFPositionChangeCategory, number>
): string =>
  template
    .replace('{limit}', String(limit))
    .replace('{newTotal}', String(total.NEW))
    .replace('{addTotal}', String(total.ADD))
    .replace('{reduceTotal}', String(total.REDUCE))
    .replace('{clearTotal}', String(total.CLEAR));

export const formatUsdCompact = (value: number, decimals = 2): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(decimals)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(decimals)}K`;
  }
  return `${sign}$${abs.toFixed(decimals)}`;
};

export const formatUsdPlain = (value: number, decimals = 2): string => {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

export const formatPct = (value: number, decimals = 2): string => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
};

export const formatSharesDelta = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M sh`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K sh`;
  return `${sign}${abs.toLocaleString('en-US')} sh`;
};

export const formatShareCount = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return abs.toLocaleString('en-US');
};

export const formatSharesChangeDetail = (
  priorShares: number | null,
  currentShares: number | null,
  sharesDelta: number
): string => {
  if (priorShares !== null && currentShares !== null) {
    return `${formatShareCount(priorShares)} → ${formatShareCount(currentShares)} (${formatSharesDelta(sharesDelta)})`;
  }
  return formatSharesDelta(sharesDelta);
};

export const hasOppositeShareValueSign = (
  sharesDelta: number,
  marketValueDeltaUsd: number
): boolean =>
  sharesDelta !== 0 &&
  marketValueDeltaUsd !== 0 &&
  Math.sign(sharesDelta) !== Math.sign(marketValueDeltaUsd);

export const CHANGE_BADGE_CLASS: Record<ThirteenFPositionChangeCategory, string> = {
  NEW: 'border-emerald-600/60 bg-emerald-950/40 text-emerald-300',
  ADD: 'border-green-600/60 bg-green-950/40 text-green-300',
  REDUCE: 'border-orange-600/60 bg-orange-950/40 text-orange-300',
  CLEAR: 'border-red-700/60 bg-red-950/40 text-red-300',
};

export const deltaTextClass = (value: number): string => {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-gray-400';
};
