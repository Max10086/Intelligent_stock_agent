import type { CompanyProfile, Language } from '../types.ts';
import {
  RESEARCH_QUESTION_DIMENSIONS,
  formatBatchDedupHint,
  getCoverageSliceForBatch,
  getDimensionIndexRange,
  getResearchQuestionDimensions,
} from './questionGenerationBatches.ts';
import { buildCompanyIdentityBlock } from './companyIdentity.ts';

export const DEFAULT_FOCUS_QUESTION_COUNT = 18;
export const DEFAULT_CANDIDATE_QUESTION_COUNT = 18;

export interface QuestionPromptBatchOptions {
  batchIndex: number;
  batchTotal: number;
  priorQuestionCount?: number;
  coverageLabels?: string[];
}

const formatBatchHeader = (
  batchIndex: number,
  batchTotal: number,
  questionCount: number,
  lang: Language
): string => {
  if (batchTotal <= 1) return '';
  if (lang === 'cn') {
    return `这是第 ${batchIndex + 1}/${batchTotal} 批。请仅生成本批 ${questionCount} 个全新问题。
`;
  }
  return `This is batch ${batchIndex + 1} of ${batchTotal}. Generate exactly ${questionCount} NEW questions for this batch only.
`;
};

const buildCoverageBlock = (
  companyName: string,
  coverageLabels: string[],
  dimensionRange: { start: number; end: number },
  lang: Language
): string => {
  if (lang === 'cn') {
    return coverageLabels.length > 0
      ? `本批覆盖要求 — 下列每个维度至少 1 个深度问题：
${coverageLabels.map((label, i) => `${dimensionRange.start + i}) ${label}`).join('\n')}`
      : `覆盖要求 — 下列 12 个维度各至少 1 个深度分析问题：
1) 供应链 / 上游资源与供给韧性
2) 市场地位、份额与竞争格局
3) 商业模式与收入结构
4) 财务表现（盈利、现金流、资产负债表）
5) 增长驱动与战略催化剂
6) 竞争优势 / 护城河
7) 关键风险与下行情景
8) 管理层、资本配置与公司治理
9) 近期新闻与近 2–3 个月事件
10) 估值水平（相对同行与历史区间）
11) 市场情绪（资金、叙事、政策、业绩预期）
12) 行业周期阶段及 ${companyName} 相对同业的位置（底部/复苏/扩张/顶部）`;
  }

  return coverageLabels.length > 0
    ? `Coverage requirements for this batch — include at least one deep question for EACH listed dimension:
${coverageLabels.map((label, i) => `${dimensionRange.start + i}) ${label}`).join('\n')}`
    : `Coverage requirements — include at least one deep, analytical question for EACH dimension:
1) Supply chain / upstream inputs and resilience
2) Market position, share, and competitive dynamics
3) Business model and revenue mix
4) Financials (profitability, cash flow, balance sheet)
5) Growth drivers and strategic catalysts
6) Competitive advantages / moat
7) Key risks and downside scenarios
8) Management quality, capital allocation, and governance
9) Recent news and near-term events (last 2-3 months)
10) Valuation vs peers and historical ranges
11) Market sentiment: current sentiment toward the stock/sector, what is priced in, and what factors could ignite or reverse sentiment (flows, narrative, policy, earnings surprises)
12) Industry cycle: the industry's cyclical framework, where the cycle stands now, and where ${companyName} sits relative to peers in this phase (trough/recovery/expansion/peak)`;
};

export const buildGenerateQuestionsPrompt = (
  company: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>,
  outputLanguage: string,
  questionCount: number,
  recencyGuidance: string,
  batch?: QuestionPromptBatchOptions,
  strictLanguageRetry = false
): string => {
  const companyName = company.name;
  const lang: Language = /chinese/i.test(outputLanguage) ? 'cn' : 'en';
  const identityBlock = buildCompanyIdentityBlock(company, lang);
  const dimensions = getResearchQuestionDimensions(lang);

  const coverageLabels =
    batch?.coverageLabels ||
    (batch
      ? getCoverageSliceForBatch(batch.batchIndex, batch.batchTotal, dimensions)
      : [...dimensions]);

  const dimensionRange = batch
    ? getDimensionIndexRange(
        batch.batchIndex,
        batch.batchTotal,
        dimensions.length
      )
    : { start: 1, end: dimensions.length };

  const coverageBlock = buildCoverageBlock(companyName, coverageLabels, dimensionRange, lang);

  const batchHeader = batch
    ? formatBatchHeader(batch.batchIndex, batch.batchTotal, questionCount, lang)
    : '';

  const dedupHint = batch
    ? formatBatchDedupHint(
        batch.batchIndex,
        batch.batchTotal,
        batch.priorQuestionCount ?? 0,
        dimensionRange,
        lang
      )
    : '';

  const languageRule =
    lang === 'cn'
      ? `【语言硬性要求】所有问题必须全部使用简体中文撰写。禁止输出英文问句或英文段落（可保留公司名、股票代码、YYYY-Qx、FYxxxx、百分比与数字）。`
      : `LANGUAGE REQUIREMENT: Every question must be written entirely in English.`;

  const depthBlock =
    lang === 'cn'
      ? `深度要求：
- 每个问题须可检索、含具体指标与日期证据（YYYY-Qx、YYYY-MM、FYxxxx）。
- 避免浅层是非题；多用「如何」「为何」「在多大程度上」「相较…」等分析式问法。
- 问题须指向可投资决策的含义，而非教科书式定义。`
      : `Depth requirements:
- Each question must require multi-source research, specific metrics, and dated evidence (YYYY-Qx, YYYY-MM, FYxxxx).
- Avoid shallow or yes/no questions; prefer "how", "why", "to what extent", and "compared with".
- Tie questions to investable implications, not textbook definitions.`;

  const intro =
    lang === 'cn'
      ? `${batchHeader}${identityBlock}

请为「${companyName}」（${company.ticker} / ${company.exchange}）生成恰好 ${questionCount} 个深度投资研究问题。输出语言：简体中文。
- 所有问题必须明确指向上述唯一公司实体；禁止针对同名/同代码的其他上市公司。
- 问题中应适当包含公司名、${company.ticker} 或 ${company.exchange}，避免检索时误匹配。

${languageRule}`
      : `${batchHeader}${identityBlock}

Generate exactly ${questionCount} in-depth critical investment research questions in English about "${companyName}" (${company.ticker} / ${company.exchange}).
- Every question MUST target this exact listed entity only — never a namesake on another exchange.
- Include the company name, ${company.ticker}, or ${company.exchange} where helpful to avoid search ambiguity.

${languageRule}`;

  const tail =
    lang === 'cn'
      ? `${coverageBlock}
${dedupHint}
${depthBlock}
${recencyGuidance}
请确保多个问题明确要求：最新季报、最近年报、以及近 2–3 个月的重要变化。
仅返回 JSON：{"questions": ["...", ...]}`
      : `${coverageBlock}
${dedupHint}
${depthBlock}
${recencyGuidance}
Ensure several questions explicitly require the latest quarter, latest annual report, and very recent 2-3 month developments.
Respond ONLY with a valid JSON object: {"questions": ["...", ...]}`;

  const strictSuffix =
    lang === 'cn'
      ? '\n\n【重试】上一批含英文问题。本批每个问题必须整句中文，不得夹英文。'
      : '\n\nRETRY: Previous batch had wrong language. Every question must be English.';

  return `${intro}

${tail}${strictLanguageRetry ? strictSuffix : ''}`;
};

export { RESEARCH_QUESTION_DIMENSIONS };
