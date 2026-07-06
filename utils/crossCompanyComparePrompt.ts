import type { CompanyCompareDigest, MarketHotTopicsSnapshot } from '../types/compare.ts';
import { COMPARE_METHODOLOGY_NOTE } from './compareScoring.ts';

export const buildCrossCompanyComparePrompt = (
  digests: CompanyCompareDigest[],
  hotTopics: MarketHotTopicsSnapshot,
  outputLanguage: string,
  strictRetry = false
): string => {
  const isChinese = /chinese|cn|中文/i.test(outputLanguage);

  const dimensionGuide = isChinese
    ? `- D1 conviction（胜率/把握）0–100：结论可信度、证据充分度、叙事一致性
- D2 upside（盈利空间）0–100：上行弹性、re-rating、预期差路径
- D3 downsideProtection（错判损失保护）0–100：下行安全垫越高分越高
- D4 marketThemeFit（市场热点相关度）0–100：与当前热点清单的实质关联度；蹭概念不给高分`
    : `- D1 conviction (0–100): thesis credibility, evidence depth, narrative consistency
- D2 upside (0–100): re-rating path, profit potential
- D3 downsideProtection (0–100): floor if wrong; higher = safer
- D4 marketThemeFit (0–100): fit with current hot themes; penalize forced narratives`;

  const base = `You are a senior portfolio analyst. Compare ${digests.length} companies using their report snapshots and current market hot topics.

${dimensionGuide}

Score each company independently. Return JSON only:
{
  "rankings": [
    {
      "itemId": "reportId::companyId",
      "dimensions": {
        "conviction": 0,
        "upside": 0,
        "downsideProtection": 0,
        "marketThemeFit": 0
      },
      "matchedThemes": [
        { "theme": "...", "relevance": "high|medium|low", "reason": "1 sentence" }
      ],
      "rationale": "2-3 sentences",
      "keyStrengths": ["...", "..."],
      "keyRisks": ["...", "..."]
    }
  ],
  "portfolioSummary": "3-5 sentences on relative priorities",
  "warnings": ["optional"]
}

Rules:
- Include EVERY itemId from company digests exactly once.
- Do NOT compute compositeScore or rank (server will do that).
- Use report snapshot facts for D1–D3; use hot topics snapshot for D4.
- Output language: ${outputLanguage}

${COMPARE_METHODOLOGY_NOTE}

Company digests:
${JSON.stringify(digests)}

Current market hot topics (for D4):
${JSON.stringify(hotTopics)}`;

  if (!strictRetry) return base;

  return `${base}

CRITICAL RETRY: Return valid JSON with rankings for ALL ${digests.length} companies. Each needs all 4 dimension scores.`;
};

export const buildCrossCompanyCompareFollowUpPrompt = (
  digests: CompanyCompareDigest[],
  hotTopics: MarketHotTopicsSnapshot,
  priorSummary: {
    createdAt: string;
    rankings: Array<{
      itemId: string;
      rank: number;
      compositeScore: number;
      dimensions: import('../types/compare.ts').CompareDimensionScores;
    }>;
    portfolioSummary: string;
    marketHotTopics: MarketHotTopicsSnapshot;
  },
  outputLanguage: string,
  strictRetry = false
): string => {
  const base = `${buildCrossCompanyComparePrompt(digests, hotTopics, outputLanguage, false)}

This is a FOLLOW-UP comparison. Prior run (${priorSummary.createdAt}) rankings:
${JSON.stringify(priorSummary.rankings)}

Prior portfolio summary:
${priorSummary.portfolioSummary}

Prior hot topics snapshot:
${JSON.stringify(priorSummary.marketHotTopics)}

Also return:
{
  "changeSummary": "Narrative explaining rank/score changes vs prior run — market theme shifts, thesis changes, what improved/worsened",
  ...same rankings structure as above...
}`;

  if (!strictRetry) return base;
  return `${base}

CRITICAL RETRY: Include changeSummary and full rankings for all companies.`;
};
