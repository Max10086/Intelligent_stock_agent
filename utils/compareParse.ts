import type {
  CompareCompanyScore,
  CompareMatchedTheme,
  CompareRunResult,
  CompanyCompareDigest,
} from '../types/compare.ts';
import { tryParseModelJson } from './modelJson.ts';
import {
  computeCompositeScore,
  normalizeDimensionScores,
  rankCompareScores,
} from './compareScoring.ts';

const normalizeMatchedThemes = (raw: unknown): CompareMatchedTheme[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const theme = typeof record.theme === 'string' ? record.theme.trim() : '';
      const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
      const relevanceRaw = typeof record.relevance === 'string' ? record.relevance.toLowerCase() : '';
      const relevance =
        relevanceRaw === 'high' || relevanceRaw === 'medium' || relevanceRaw === 'low'
          ? relevanceRaw
          : 'medium';
      if (!theme) return null;
      return { theme, relevance, reason: reason || theme };
    })
    .filter(Boolean) as CompareMatchedTheme[];
};

export const parseCompareLlmResponse = (
  rawText: string,
  expectedItemIds: string[]
): {
  rankings: CompareCompanyScore[];
  portfolioSummary: string;
  changeSummary?: string;
  warnings?: string[];
} => {
  const parsed = (tryParseModelJson(rawText) || {}) as Record<string, unknown>;
  const rankingsRaw = Array.isArray(parsed.rankings) ? parsed.rankings : [];
  const byItemId = new Map<string, CompareCompanyScore>();

  for (const entry of rankingsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : '';
    if (!itemId) continue;

    const dimensions = normalizeDimensionScores(
      record.dimensions as Record<string, number> | undefined
    );
    const strengths = Array.isArray(record.keyStrengths)
      ? record.keyStrengths.filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
      : [];
    const risks = Array.isArray(record.keyRisks)
      ? record.keyRisks.filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
      : [];

    byItemId.set(itemId, {
      itemId,
      rank: 0,
      dimensions,
      matchedThemes: normalizeMatchedThemes(record.matchedThemes).slice(0, 5),
      compositeScore: computeCompositeScore(dimensions),
      rationale: typeof record.rationale === 'string' ? record.rationale.trim() : '',
      keyStrengths: strengths.slice(0, 3),
      keyRisks: risks.slice(0, 3),
    });
  }

  const missing = expectedItemIds.filter(id => !byItemId.has(id));
  for (const itemId of missing) {
    byItemId.set(itemId, {
      itemId,
      rank: 0,
      dimensions: normalizeDimensionScores({}),
      matchedThemes: [],
      compositeScore: 0,
      rationale: '',
      keyStrengths: [],
      keyRisks: [],
    });
  }

  const ranked = rankCompareScores([...byItemId.values()]);

  const portfolioSummary =
    typeof parsed.portfolioSummary === 'string' ? parsed.portfolioSummary.trim() : '';
  const changeSummary =
    typeof parsed.changeSummary === 'string' ? parsed.changeSummary.trim() : undefined;
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === 'string' && Boolean(w.trim()))
    : undefined;

  return {
    rankings: ranked,
    portfolioSummary,
    changeSummary,
    warnings,
  };
};

export const buildCompareRunResult = (
  partial: Omit<CompareRunResult, 'methodologyNote'> & { methodologyNote?: string }
): CompareRunResult => ({
  ...partial,
  methodologyNote:
    partial.methodologyNote ||
    'Composite = (40×D1 + 30×D2 + 20×D3 + 20×D4) / 100. Rankings use server-side formula on LLM dimension scores.',
});

export const summarizePriorRun = (prior: CompareRunResult) => ({
  createdAt: prior.createdAt,
  rankings: prior.rankings.map(r => ({
    itemId: r.itemId,
    rank: r.rank,
    compositeScore: r.compositeScore,
    dimensions: r.dimensions,
  })),
  portfolioSummary: prior.portfolioSummary,
  marketHotTopics: prior.marketHotTopics,
});

export const extractDigestsFromRun = (run: CompareRunResult): CompanyCompareDigest[] =>
  run.digests || [];
