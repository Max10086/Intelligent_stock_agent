import type { FinalConclusion, FinalConclusionDecision } from '../types.ts';
import { cleanupBrokenNumericFormatting, mergeBrokenEvidenceFragments } from './textNormalize.ts';

const getFirstString = (obj: any, keys: string[]): string => {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeEvidenceList = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    const items = value
      .flatMap(item => {
        if (typeof item === 'string') return [item.trim()];
        if (item && typeof item === 'object') {
          const text =
            (item as { text?: string }).text ||
            (item as { fact?: string }).fact ||
            (item as { evidence?: string }).evidence;
          return typeof text === 'string' ? [text.trim()] : [];
        }
        return [];
      })
      .filter(Boolean);
    return mergeBrokenEvidenceFragments(items);
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
};

const normalizeFinalBulletPoint = (point: any): { argument: string; evidence: string[] } => ({
  argument: cleanupBrokenNumericFormatting(
    getFirstString(point, ['argument', 'title', 'point', 'claim', 'summary'])
  ),
  evidence: normalizeEvidenceList(
    point?.evidence ??
      point?.data_points ??
      point?.dataPoints ??
      point?.facts ??
      point?.proof
  ),
});

const normalizeGapAssessment = (value: unknown): 'Limited' | 'Significant' | undefined => {
  if (value === 'Limited' || value === 'Significant') return value;
  const text = String(value || '').trim();
  if (/^limited$/i.test(text)) return 'Limited';
  if (/^significant$/i.test(text)) return 'Significant';
  return undefined;
};

const normalizeDecision = (raw: any): FinalConclusionDecision | undefined => {
  const decisionRaw = raw?.decision ?? raw?.analysis_decision ?? raw?.analysisDecision;
  if (!decisionRaw || typeof decisionRaw !== 'object') return undefined;

  const rating = getFirstString(decisionRaw, ['rating', 'official_rating', 'officialRating']);
  const confidenceRaw = decisionRaw.confidence_score ?? decisionRaw.confidenceScore ?? decisionRaw.confidence;
  const confidenceScore =
    typeof confidenceRaw === 'number'
      ? confidenceRaw
      : Number.parseInt(String(confidenceRaw || '').replace(/[^\d]/g, ''), 10);

  const bearCaseDownside = getFirstString(decisionRaw, [
    'bear_case_downside',
    'bearCaseDownside',
    'bear_downside',
    'downside',
  ]);
  const thesisInvalidation = getFirstString(decisionRaw, [
    'thesis_invalidation',
    'thesisInvalidation',
    'invalidation',
  ]);

  const conditionsRaw =
    decisionRaw.bear_case_conditions ??
    decisionRaw.bearCaseConditions ??
    decisionRaw.conditions ??
    [];
  const bearCaseConditions = Array.isArray(conditionsRaw)
    ? conditionsRaw.map(item => cleanupBrokenNumericFormatting(String(item || '').trim())).filter(Boolean)
    : normalizeEvidenceList(conditionsRaw);

  if (!rating || !Number.isFinite(confidenceScore) || !bearCaseDownside || !thesisInvalidation) {
    return undefined;
  }

  return {
    rating: cleanupBrokenNumericFormatting(rating),
    confidence_score: Math.min(5, Math.max(1, confidenceScore)),
    bear_case_downside: cleanupBrokenNumericFormatting(bearCaseDownside),
    gap_assessment: normalizeGapAssessment(decisionRaw.gap_assessment ?? decisionRaw.gapAssessment),
    thesis_invalidation: cleanupBrokenNumericFormatting(thesisInvalidation),
    bear_case_conditions: bearCaseConditions,
  };
};

export const normalizeFinalConclusion = (raw: any): FinalConclusion => {
  const bulletRaw =
    raw?.bullet_points ??
    raw?.bulletPoints ??
    raw?.key_points ??
    raw?.keyPoints ??
    raw?.points ??
    raw?.arguments ??
    [];
  const bulletPoints = Array.isArray(bulletRaw)
    ? bulletRaw.map(normalizeFinalBulletPoint)
    : normalizeEvidenceList(bulletRaw).map(text => ({ argument: text, evidence: [] as string[] }));

  return {
    overall_conclusion: cleanupBrokenNumericFormatting(
      getFirstString(raw, [
        'overall_conclusion',
        'overallConclusion',
        'conclusion',
        'recommendation',
        'verdict',
      ])
    ),
    bullet_points: bulletPoints.filter(point => point.argument || point.evidence.length > 0),
    decision: normalizeDecision(raw),
    vs_prior: raw?.vs_prior
      ? {
          prior_overall_conclusion: cleanupBrokenNumericFormatting(
            getFirstString(raw.vs_prior, ['prior_overall_conclusion', 'priorOverallConclusion', 'prior_conclusion'])
          ),
          rating_change: (['upgrade', 'maintain', 'downgrade', 'unknown'] as const).includes(
            raw.vs_prior?.rating_change
          )
            ? raw.vs_prior.rating_change
            : undefined,
          change_summary: cleanupBrokenNumericFormatting(
            getFirstString(raw.vs_prior, ['change_summary', 'changeSummary', 'summary'])
          ),
        }
      : undefined,
  };
};
