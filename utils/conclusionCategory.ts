export type ConclusionCategory =
  | 'strong_buy'
  | 'buy'
  | 'overweight'
  | 'hold'
  | 'sell'
  | 'other';

/** Categories shown as primary tabs on the analysis catalog page. */
export const CATALOG_DISPLAY_CATEGORIES: ConclusionCategory[] = [
  'strong_buy',
  'buy',
  'overweight',
  'hold',
  'sell',
];

export function classifyConclusion(text: string | null | undefined): ConclusionCategory {
  const raw = (text || '').trim();
  if (!raw) return 'other';

  if (/强烈买入|强力买入|强力推荐|strong buy|conviction buy/i.test(raw)) {
    return 'strong_buy';
  }
  if (/强烈卖出|strong sell/i.test(raw)) {
    return 'sell';
  }
  if (/卖出|减持|\bsell\b|\breduce\b/i.test(raw)) {
    return 'sell';
  }
  if (/增持|\boverweight\b/i.test(raw)) {
    return 'overweight';
  }
  if (/买入|推荐|\bbuy\b/i.test(raw)) {
    return 'buy';
  }
  if (/持有|\bhold\b|\bneutral\b|中性/i.test(raw)) {
    return 'hold';
  }

  return 'other';
}

export interface ConclusionTagStyle {
  labelKey:
    | 'batchConclusionStrongBuy'
    | 'batchConclusionBuy'
    | 'batchConclusionOverweight'
    | 'batchConclusionSell'
    | 'batchConclusionHold'
    | 'batchConclusionUnclassified';
  className: string;
}

export function getConclusionTagStyle(category: ConclusionCategory): ConclusionTagStyle {
  switch (category) {
    case 'strong_buy':
      return {
        labelKey: 'batchConclusionStrongBuy',
        className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
      };
    case 'buy':
      return {
        labelKey: 'batchConclusionBuy',
        className: 'bg-green-500/20 text-green-300 border-green-500/50',
      };
    case 'overweight':
      return {
        labelKey: 'batchConclusionOverweight',
        className: 'bg-teal-500/20 text-teal-300 border-teal-500/50',
      };
    case 'sell':
      return {
        labelKey: 'batchConclusionSell',
        className: 'bg-red-500/20 text-red-300 border-red-500/50',
      };
    case 'hold':
      return {
        labelKey: 'batchConclusionHold',
        className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50',
      };
    default:
      return {
        labelKey: 'batchConclusionUnclassified',
        className: 'bg-slate-500/20 text-slate-300 border-slate-500/50',
      };
  }
}

export function getCatalogCategoryLabelKey(
  category: ConclusionCategory
):
  | 'catalogCategoryStrongBuy'
  | 'catalogCategoryBuy'
  | 'catalogCategoryOverweight'
  | 'catalogCategoryHold'
  | 'catalogCategorySell'
  | 'catalogCategoryOther' {
  switch (category) {
    case 'strong_buy':
      return 'catalogCategoryStrongBuy';
    case 'buy':
      return 'catalogCategoryBuy';
    case 'overweight':
      return 'catalogCategoryOverweight';
    case 'hold':
      return 'catalogCategoryHold';
    case 'sell':
      return 'catalogCategorySell';
    default:
      return 'catalogCategoryOther';
  }
}
