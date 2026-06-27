import { InvestmentConclusion } from '../types.ts';
import { formatTopicCompressedQnaDigest, CompressibleQnA } from './qnaTopicCompression.ts';
import { THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';

const FINAL_CONCLUSION_JSON_EXAMPLE_CN = `{
  "overall_conclusion": "减持。宏和科技估值严重泡沫化，短期回调风险显著高于潜在收益。\\n\\n公司2026Q1营收与利润爆发式增长，AI高端电子布需求强劲，但804倍PE已充分定价乐观预期。上游原材料暴涨206%持续挤压毛利率，巨额资本开支令自由现金流为负，公司自身亦警示非理性炒作风险。与行业龙头相比弹性更大，但在情绪过热背景下，风险回报比明显不利。",
  "bullet_points": [
    {
      "argument": "估值极端透支，安全边际不足",
      "evidence": [
        "当前PE-TTM约804倍，显著高于行业112倍",
        "2026年6月公司公告提示估值偏离基本面"
      ]
    },
    {
      "argument": "成本剪刀差压制盈利质量",
      "evidence": [
        "2026Q1原材料采购价同比暴涨206.55%",
        "2026Q1电子布均价9.78元/米，同比上涨116.85%"
      ]
    },
    {
      "argument": "现金流与资本开支形成结构性压力",
      "evidence": [
        "2026Q1经营现金流仅增15.3%",
        "自由现金流因巨额资本开支持续为负"
      ]
    },
    {
      "argument": "市场情绪过热，短期回落风险高",
      "evidence": [
        "2025年6月以来累计涨幅超2000%",
        "2026年6月连续3日收盘偏离值累计超20%"
      ]
    },
    {
      "argument": "行业景气向上但公司份额仍有限",
      "evidence": [
        "AI算力驱动电子布需求爆发",
        "2026Q1市占率仍低于行业龙头中国巨石"
      ]
    }
  ]
}`;

const FINAL_CONCLUSION_JSON_EXAMPLE_EN = `{
  "overall_conclusion": "Reduce. Valuation is severely stretched and near-term pullback risk outweighs upside.\\n\\n2026Q1 revenue and earnings surged on AI electronic-glass demand, but an 804x PE already prices in optimism. Upstream costs rose 206% and heavy capex keeps FCF negative; management warned of irrational speculation. The firm is more levered than larger peers, but risk-reward is unfavorable amid euphoric sentiment.",
  "bullet_points": [
    {
      "argument": "Extreme valuation leaves no margin of safety",
      "evidence": [
        "PE-TTM ~804x vs industry ~112x",
        "Jun 2026 company risk disclosure flagged overvaluation"
      ]
    },
    {
      "argument": "Cost inflation compresses earnings quality",
      "evidence": [
        "2026Q1 raw material costs +206.55% YoY",
        "2026Q1 electronic-glass ASP +116.85% YoY"
      ]
    },
    {
      "argument": "Capex-heavy model strains cash flow",
      "evidence": [
        "2026Q1 operating cash flow up only 15.3%",
        "Free cash flow remained negative due to heavy capex"
      ]
    },
    {
      "argument": "Sentiment overheated; pullback risk elevated",
      "evidence": [
        "Share price up >2000% since Jun 2025",
        "Three-day closing deviation exceeded 20% in Jun 2026"
      ]
    },
    {
      "argument": "Industry tailwind does not fully offset scale gap",
      "evidence": [
        "AI demand drives electronic-glass upcycle",
        "2026Q1 share still below leading peer China Jushi"
      ]
    }
  ]
}`;

const formatThesisContext = (conclusion: InvestmentConclusion): Record<string, unknown> =>
  Object.fromEntries(
    THESIS_SECTION_KEYS.map(key => [
      key,
      {
        summary: conclusion[key]?.summary || '',
        evidence: conclusion[key]?.evidence || [],
      },
    ])
  );

export const buildFinalConclusionPrompt = (
  companyName: string,
  outputLanguage: string,
  recencyGuidance: string,
  conclusion: InvestmentConclusion,
  supplementalQna: CompressibleQnA[] = []
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const jsonExample = isChinese ? FINAL_CONCLUSION_JSON_EXAMPLE_CN : FINAL_CONCLUSION_JSON_EXAMPLE_EN;
  const thesisContext = formatThesisContext(conclusion);
  const qnaDigest = supplementalQna.length ? formatTopicCompressedQnaDigest(supplementalQna, 800) : undefined;

  return `You are a senior investment analyst. Based on the investment thesis below for "${companyName}", provide a final, decisive investment conclusion in ${outputLanguage}.

HARD REQUIREMENTS (must follow exactly):
- Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
- "overall_conclusion" MUST have TWO parts separated by a blank line (use \\n\\n):
  1) First sentence: clear rating (e.g., Strong Buy / Hold / Reduce / Sell).
  2) Second part: 3-5 sentence executive summary weaving the most critical insights across thesis sections (bull vs bear, valuation vs growth, sentiment vs fundamentals).
- "bullet_points" MUST contain 5 to 7 items. An empty array is NOT allowed.
- Each bullet MUST have a non-empty "argument" and 2-3 non-empty "evidence" strings.
- Each evidence item MUST cite specific numbers, dates, periods, or facts from the thesis (and supplemental Q&A digest if provided).
- When sections conflict (e.g., strong growth vs valuation risk), reflect that tension in the rating.
- Stay consistent with the thesis below; do not contradict it without citing newer evidence.

Required JSON shape (follow this structure exactly):
${jsonExample}

Investment thesis (7 sections):
${JSON.stringify(thesisContext)}

${qnaDigest ? `Supplemental topic-compressed Q&A digest:\n${JSON.stringify(qnaDigest)}\n` : ''}
${recencyGuidance}

Respond ONLY with a valid JSON object matching the required shape above.`;
};

export const buildFinalConclusionStrictRetrySuffix = (): string =>
  'CRITICAL RETRY: Put the FULL JSON in the response content field. overall_conclusion MUST include rating + 3-5 sentence executive summary (use \\n\\n). bullet_points MUST contain 5-7 items, each with 2-3 evidence strings.';
