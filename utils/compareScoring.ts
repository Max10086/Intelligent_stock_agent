import type { CompareDimensionScores } from '../types/compare.ts';

export const COMPARE_WEIGHTS = {
  conviction: 40,
  upside: 30,
  downsideProtection: 20,
  marketThemeFit: 20,
} as const;

export const COMPARE_METHODOLOGY_NOTE =
  'Composite = (40×D1 + 30×D2 + 20×D3 + 20×D4) / 100. D1=conviction, D2=upside, D3=downside protection, D4=market theme fit.';

const clampScore = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

export const normalizeDimensionScores = (
  raw: Partial<CompareDimensionScores> | null | undefined
): CompareDimensionScores => ({
  conviction: clampScore(raw?.conviction),
  upside: clampScore(raw?.upside),
  downsideProtection: clampScore(raw?.downsideProtection),
  marketThemeFit: clampScore(raw?.marketThemeFit),
});

export const computeCompositeScore = (dimensions: CompareDimensionScores): number => {
  const score =
    (COMPARE_WEIGHTS.conviction * dimensions.conviction +
      COMPARE_WEIGHTS.upside * dimensions.upside +
      COMPARE_WEIGHTS.downsideProtection * dimensions.downsideProtection +
      COMPARE_WEIGHTS.marketThemeFit * dimensions.marketThemeFit) /
    100;
  return Math.round(score * 10) / 10;
};

export const rankCompareScores = <
  T extends { itemId: string; dimensions: CompareDimensionScores; compositeScore?: number },
>(
  entries: T[]
): Array<T & { compositeScore: number; rank: number }> => {
  const scored = entries.map(entry => {
    const dimensions = normalizeDimensionScores(entry.dimensions);
    const compositeScore = computeCompositeScore(dimensions);
    return { ...entry, dimensions, compositeScore };
  });

  scored.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.dimensions.conviction !== a.dimensions.conviction) {
      return b.dimensions.conviction - a.dimensions.conviction;
    }
    if (b.dimensions.upside !== a.dimensions.upside) return b.dimensions.upside - a.dimensions.upside;
    return a.itemId.localeCompare(b.itemId);
  });

  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
};
