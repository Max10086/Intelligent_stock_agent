import { InvestmentConclusion } from '../types.ts';
import { Type } from '@google/genai';
import { formatTopicCompressedQnaDigest, CompressibleQnA } from './qnaTopicCompression.ts';
import { THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';
import {
  buildFinalConclusionStrictRetrySuffix as buildStrictRetrySuffix,
} from './analysisComplete.ts';

export { buildFinalConclusionStrictRetrySuffix, hasUsableFinalConclusion } from './analysisComplete.ts';

export const FINAL_CONCLUSION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    decision: {
      type: Type.OBJECT,
      properties: {
        rating: {
          type: Type.STRING,
          description: 'Official rating from the Bear Case matrix (e.g. Overweight, Strong Buy).',
        },
        confidence_score: {
          type: Type.INTEGER,
          description: 'Thesis confidence score 1-5.',
        },
        bear_case_downside: {
          type: Type.STRING,
          description: 'Estimated downside if thesis fails (e.g. 15-25%).',
        },
        gap_assessment: {
          type: Type.STRING,
          description: 'Expectation gap assessment: Limited or Significant.',
        },
        thesis_invalidation: {
          type: Type.STRING,
          description: 'Explicit thesis invalidation condition with time window.',
        },
        bear_case_conditions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'At least 3 specific conditions that could invalidate the thesis.',
        },
      },
      required: [
        'rating',
        'confidence_score',
        'bear_case_downside',
        'thesis_invalidation',
        'bear_case_conditions',
      ],
    },
    overall_conclusion: {
      type: Type.STRING,
      description:
        'Clean sell-side executive summary prose only. No section headers or structured dumps.',
    },
    bullet_points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          argument: {
            type: Type.STRING,
            description: 'A single, key investment argument (pro or con).',
          },
          evidence: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-3 specific data points supporting the argument.',
          },
        },
        required: ['argument', 'evidence'],
      },
    },
  },
  required: ['decision', 'overall_conclusion', 'bullet_points'],
};

export const buildFollowUpFinalConclusionStrictRetrySuffix = (qualityIssues: string[] = []): string =>
  `${buildStrictRetrySuffix(qualityIssues)} MUST include valid "vs_prior" with prior_overall_conclusion, rating_change (upgrade/maintain/downgrade), and change_summary.`;

const FINAL_CONCLUSION_JSON_EXAMPLE_CN = `{
  "decision": {
    "rating": "Overweight",
    "confidence_score": 4,
    "bear_case_downside": "15-25%",
    "gap_assessment": "Limited",
    "thesis_invalidation": "如果2026年半年报中固态电池收入未超2亿元且锂价在Q3回落至8万元/吨以下，本thesis将失效，建议立即重新评估",
    "bear_case_conditions": [
      "2026年H2碳酸锂均价跌破8万元/吨，使H1业绩预告中的价格反弹逻辑逆转",
      "2026年半年报固态电池收入低于2亿元，商业化进展不达预期",
      "墨西哥Sonora项目因政策变更最终放弃，产生10-20亿元减值损失"
    ]
  },
  "overall_conclusion": "增持（预期差有限）。赣锋锂业当前股价对应PE-TTM 26.7倍、PB约1.5倍，动态估值已部分反映2026年业绩复苏与固态电池叙事。2026H1净利润预增787%-966%，锂价回升与资源自给率提升驱动业绩强劲反转，基于2026H1年化PE约12倍，当前估值具备一定安全边际。预期差有限：市场已price-in大部分乐观预期，进一步上行需固态电池收入突破2亿元或锂价 sustained above 8万元/吨；若关键验证节点落空，下行风险约15-25%。",
  "bullet_points": [
    {
      "argument": "Bear Case: 锂价回落与固态电池商业化不及预期",
      "evidence": [
        "2026年H2碳酸锂均价若跌破8万元/吨，H1价格反弹逻辑将逆转",
        "2026年半年报固态电池收入若低于2亿元，商业化 thesis 将受挑战"
      ]
    },
    {
      "argument": "Thesis 失效条件：固态电池收入与锂价双验证",
      "evidence": [
        "若2026年半年报固态电池收入未超2亿元且锂价Q3回落至8万元/吨以下，本 thesis 将失效",
        "关键验证节点在2026年半年报"
      ]
    },
    {
      "argument": "估值安全边际：动态PE合理但上行空间有限",
      "evidence": [
        "PE-TTM 26.7倍，基于2026H1年化PE约12倍",
        "PB约1.5倍，估值已部分反映2026年业绩复苏"
      ]
    },
    {
      "argument": "预期差有限：上涨依赖业绩兑现而非超预期",
      "evidence": [
        "ExpectationGap 节标注 Limited gap",
        "当前股价已反映大部分乐观预期，评级主要基于业绩确定性带来的安全边际"
      ]
    },
    {
      "argument": "2026H1业绩反转提供短期确定性",
      "evidence": [
        "2026H1净利润预增787%-966%",
        "锂价回升与资源自给率提升驱动盈利修复"
      ]
    },
    {
      "argument": "固态电池叙事仍待半年报验证",
      "evidence": [
        "2025年全年固态电池收入约1亿元",
        "缺乏 eVTOL 送样等硬证据，商业化进展存在不确定性"
      ]
    },
    {
      "argument": "资源自给率提升构筑成本护城河",
      "evidence": [
        "锂资源自给率持续提升，降低外购锂盐成本波动",
        "2026Q1 硬数据支撑盈利对锂价敏感度下降"
      ]
    },
    {
      "argument": "下游需求复苏支撑锂盐价格中枢",
      "evidence": [
        "2026H1 业绩预告隐含锂价较2025年低点明显反弹",
        "储能与动力电池需求回暖支撑行业景气"
      ]
    }
  ]
}`;

const FINAL_CONCLUSION_JSON_EXAMPLE_EN = `{
  "decision": {
    "rating": "Strong Buy",
    "confidence_score": 5,
    "bear_case_downside": "15-20%",
    "gap_assessment": "Significant",
    "thesis_invalidation": "If 2026 Q2 Reality Labs losses widen beyond $5B or Llama enterprise API growth stalls below 20% YoY, this thesis fails — re-evaluate immediately",
    "bear_case_conditions": [
      "2026 Q2 ad growth decelerates below 20% YoY as macro softens",
      "Reality Labs losses widen beyond $5B/quarter with no monetization path",
      "Regulatory action forces App Tracking Transparency-style ad targeting rollback"
    ]
  },
  "overall_conclusion": "Strong Buy. Meta Platforms, Inc. trades at $582.90, or 21.2x TTM P/E — below the S&P 500 — while the median analyst target of $856 implies ~47% upside and consensus is strongly bullish. 2026 Q1 ad revenue grew 33% YoY as AI-driven ad efficiency and share gains continued; in-house MTIA chips now cover 45% of inference workloads and cut per-inference cost 22%, building a structural cost moat. A clear expectation gap remains: retail sentiment still anchors on recession and 'VR money pit' narratives, but the upcoming 2026 Q2 report could catalyze a re-rating from ad-multiple to AI-infrastructure premium if Reality Labs losses narrow or Llama enterprise API usage surges. With a healthy balance sheet and $15.6B net cash, META offers asymmetric downside protection in macro volatility — risk/reward is highly attractive.",
  "bullet_points": [
    {
      "argument": "Bear Case: Ad deceleration and Reality Labs drag",
      "evidence": [
        "If 2026 Q2 ad growth falls below 20% YoY, revenue thesis weakens",
        "Reality Labs losses above $5B/quarter would cap re-rating"
      ]
    },
    {
      "argument": "Thesis invalidation: Q2 catalyst miss",
      "evidence": [
        "If 2026 Q2 Reality Labs losses widen beyond $5B or Llama API growth stalls, thesis fails",
        "2026 Q2 earnings is the key verification milestone"
      ]
    },
    {
      "argument": "Valuation margin of safety: below index, large upside to targets",
      "evidence": [
        "21.2x TTM P/E vs S&P 500 median",
        "Analyst median target $856 vs $582.90 current (~47% upside)"
      ]
    },
    {
      "argument": "Significant expectation gap: retail vs institutional divergence",
      "evidence": [
        "ExpectationGap section marked Significant gap",
        "Retail still anchored on recession/VR narrative while institutions are strongly bullish"
      ]
    },
    {
      "argument": "AI ad efficiency drives durable revenue growth",
      "evidence": [
        "2026 Q1 ad revenue +33% YoY",
        "MTIA covers 45% inference load, -22% per-inference cost"
      ]
    },
    {
      "argument": "Balance sheet supports downside asymmetry",
      "evidence": [
        "$15.6B net cash",
        "Healthy FCF generation through macro volatility"
      ]
    },
    {
      "argument": "AI infrastructure pivot expands TAM beyond ads",
      "evidence": [
        "Llama enterprise API adoption accelerating among Fortune 500",
        "Reality Labs losses narrowing QoQ per management guidance"
      ]
    },
    {
      "argument": "Share repurchases provide additional return of capital",
      "evidence": [
        "$50B+ authorized buyback program",
        "Repurchases accelerated in 2026 Q1 at sub-index multiples"
      ]
    }
  ]
}`;

const OVERALL_CONCLUSION_STYLE_BLOCK_CN = `- "overall_conclusion" 必须是简洁、易读的卖方风格 executive summary（参考下方 Meta 示例），禁止放入结构化分析块。
- 禁止在 overall_conclusion 中使用 【】 标题、步骤编号清单、或 Bear Case / 置信度 / Executive Summary 分段。
- 首句必须以明确评级开头，格式："[中文评级]。" 或 "[中文评级]（预期差有限）。"（Limited gap 时在评级后标注「预期差有限」）
- 正文 2-4 段连贯 prose，150-400 汉字，必须自然融入（勿用标题或列表）：
  - 当前股价/估值（含具体数字）
  - 核心 bull case 驱动与最新业绩证据
  - 预期差判断（Limited / Significant）及上涨/下行逻辑
  - 一句带过关键风险（勿展开 3 条 Bear Case 清单）
- Meta 示例风格：「强力买入。Meta Platforms, Inc.当前股价$582.90对应21.2倍TTM市盈率…」`;

const OVERALL_CONCLUSION_STYLE_BLOCK_EN = `- "overall_conclusion" MUST be a clean, readable sell-side executive summary (see Meta example below). Do NOT dump structured analysis blocks into it.
- Do NOT use 【】 headers, numbered checklists, or Bear Case / Confidence / Executive Summary sections in overall_conclusion.
- First sentence MUST lead with an explicit rating: "[Rating]." or "[Rating] (limited expectation gap)."
- Body: 2-4 flowing paragraphs, 120-250 English words, naturally weaving in (no headers or lists):
  - Current price/valuation with specific numbers
  - Core bull-case drivers and latest earnings evidence
  - Expectation-gap assessment (Limited / Significant) and upside/downside logic
  - One sentence on key risk — do NOT expand the 3 Bear Case conditions here
- Meta-style example: "Strong Buy. Meta Platforms, Inc. trades at $582.90, or 21.2x TTM P/E…"`;

const BEAR_CASE_AND_RATING_BLOCK_CN = `- 在给出任何评级之前，你必须先在内部完成以下四个步骤；结构化输出写入 "decision" 对象，NOT overall_conclusion：

步骤一：Bear Case 强制检验 → 写入 decision.bear_case_conditions（至少 3 条）和 decision.bear_case_downside
- 列出至少 3 个可能导致当前乐观 thesis 失效的具体条件
- 估算 thesis 失效时股价下行空间（百分比区间，如 15-25%）
- 判断当前估值是否已 price in 部分乐观预期
- 若 Bear Case 下行 > 25%，须在 decision.rating 中体现

步骤二：Thesis 置信度评分 → 写入 decision.confidence_score（1-5 整数）
评分维度：证据链完整度、数据新鲜度、逻辑可证伪性
- 5 分：三维度均强，关键论断有最新季报/月报数据直接支撑
- 4 分：两维度强，一维度中等
- 3 分：证据链有缺口或 catalyst 时间窗口不确定
- 2 分：主要依赖叙事/概念
- 1 分：证据薄弱或存在明显反证

评级上限：评分 ≤ 3 最高 Hold；评分 ≤ 2 最高 Reduce

步骤三：评级决策 → 写入 decision.rating（按以下矩阵）

| 置信度 | Bear 下行 < 15% | Bear 下行 15-25% | Bear 下行 > 25% |
| 5 分 | Strong Buy | Buy | Overweight |
| 4 分 | Buy | Overweight | Hold |
| 3 分 | Overweight | Hold | Reduce |
| 2 分 | Hold | Reduce | Sell |
| 1 分 | Reduce | Sell | Sell |

步骤四：Thesis 失效条件 → 写入 decision.thesis_invalidation
格式："如果 [具体条件] 在 [时间窗口] 内发生，本 thesis 将失效，建议立即重新评估"

ExpectationGap 处理 → 写入 decision.gap_assessment（"Limited" 或 "Significant"，读取 thesis 中 ExpectationGap.gap_assessment）
- Limited：禁止 Strong Buy；Buy 须注明预期差有限；Bear Case 取区间上限
- Significant + 置信度 5：可 Strong Buy，bullet_points 须含验证节点

完成四步后，再撰写 overall_conclusion（见上方 prose 要求），首句 rating 须与 decision.rating 一致。`;

const BEAR_CASE_AND_RATING_BLOCK_EN = `- Before assigning any rating, complete these four steps INTERNALLY; put structured output in "decision", NOT overall_conclusion:

Step 1 — Bear Case → decision.bear_case_conditions (≥3 items) and decision.bear_case_downside
- List ≥3 specific thesis-invalidation conditions
- Estimate downside if thesis fails (percentage range, e.g., 15-25%)
- Assess whether valuation already prices in optimism
- If Bear downside > 25%, reflect in decision.rating

Step 2 — Confidence score → decision.confidence_score (integer 1-5)
Dimensions: evidence completeness, data freshness, falsifiability
- 5: all strong with latest quarterly data
- 4: two strong, one moderate
- 3: evidence gaps or uncertain catalyst timing
- 2: mostly narrative/concept
- 1: weak evidence or contradicting data

Rating caps: score ≤ 3 max Hold; score ≤ 2 max Reduce

Step 3 — Rating matrix → decision.rating

| Confidence | Bear < 15% | Bear 15-25% | Bear > 25% |
| 5 | Strong Buy | Buy | Overweight |
| 4 | Buy | Overweight | Hold |
| 3 | Overweight | Hold | Reduce |
| 2 | Hold | Reduce | Sell |
| 1 | Reduce | Sell | Sell |

Step 4 — Thesis invalidation → decision.thesis_invalidation
"If [condition] occurs within [time window], this thesis fails — re-evaluate immediately"

ExpectationGap → decision.gap_assessment ("Limited" or "Significant")
- Limited: no Strong Buy; conservative Bear Case; Buy must note limited gap
- Significant + score 5: Strong Buy allowed; bullets must list verification milestones

Then write overall_conclusion (prose rules above); opening rating MUST match decision.rating.`;

const BULLET_POINTS_BLOCK_CN = `- "bullet_points" MUST contain 8 to 12 items. An empty array is NOT allowed.
- 必选 4 类 bullet（各至少 1 条）：
  1. Bear Case（argument 以 "Bear Case:" 开头）
  2. Thesis 失效条件（argument 含「失效」或 "invalidation"）
  3. 估值安全边际（含 PE/PS 与历史中枢、同业比较）
  4. 预期差（读取 gap_assessment）：
     - Limited：argument 以 "预期差有限：" 开头
     - Significant：量化上涨空间并含验证节点
- 除上述 4 类外，须再写 4-8 条**实质性投资论据**，从 8 节投资论点中提炼，覆盖尽可能多的维度，例如：
  - 竞争优势 / 成本壁垒 / 产业链一体化
   - 成长催化剂 / 新产品商业化 / 市场份额
  - 财务健康 / 现金流 / 分红与资本结构
  - 行业景气 / 供需格局 / 政策与监管红利
- 每条 argument 应是简洁有力的主题句（示例：「估值深度折价，股息率极具吸引力」「全产业链一体化构筑绝对成本优势」），勿写成长段落。
- 每个 bullet MUST have a non-empty "argument" and 2-3 non-empty "evidence" strings.
- 每个 evidence item MUST cite specific numbers, dates, periods, or facts from the thesis (and supplemental Q&A digest if provided).
- 当论点之间存在冲突（增长 vs 估值），必须在 rating 中体现这种张力，不要和稀泥。
- 保持与 thesis 一致；如果没有新的证据，不要自相矛盾。
${'{marketContextRule}'}`;

const BULLET_POINTS_BLOCK_EN = `- "bullet_points" MUST contain 8 to 12 items. An empty array is NOT allowed.
- Four mandatory categories (at least one bullet each):
  1. Bear Case (argument MUST start with "Bear Case:")
  2. Thesis invalidation (argument mentions invalidation / 失效)
  3. Valuation margin of safety (PE/PS vs historical median and peers)
  4. Expectation gap (read gap_assessment):
     - Limited: argument starts with "Limited expectation gap:" / "预期差有限："
     - Significant: quantify upside with verification milestones
- BEYOND those four, add 4-8 **substantive investment thesis bullets** drawn from the 8-section thesis, covering as many dimensions as possible, e.g.:
  - Competitive moat / cost advantage / vertical integration
  - Growth catalysts / new product commercialization / market share
  - Financial strength / cash flow / dividends / balance sheet
  - Industry cycle / supply-demand / policy tailwinds
- Each argument MUST be a crisp thematic headline (e.g., "Deep valuation discount with attractive dividend yield"), NOT a long paragraph.
- Each bullet MUST have a non-empty "argument" and 2-3 non-empty "evidence" strings.
- Each evidence item MUST cite specific numbers, dates, periods, or facts from the thesis (and supplemental Q&A digest if provided).
- When sections conflict (growth vs valuation), reflect tension in the rating — do not equivocate.
- Stay consistent with the thesis; do not contradict without newer evidence.
${'{marketContextRule}'}`;

const EXPECTATION_GAP_RATING_RULES_CN = `
评级限制规则（读取 Investment thesis 中 ExpectationGap.gap_assessment，写入 decision.gap_assessment）：
- 若 gap_assessment 为 "Limited"：
  - decision.rating 禁止 Strong Buy / 强烈买入
  - 若 decision.rating 为 Buy / 买入，overall_conclusion 首句须注明「预期差有限」
  - decision.bear_case_downside 须更保守（取区间上限）
- 若 gap_assessment 为 "Significant" 且 decision.confidence_score 为 5：
  - 可以给出 Strong Buy，但 bullet_points 中须明确列出验证节点和止损条件`;

const EXPECTATION_GAP_RATING_RULES_EN = `
Rating restriction rules (read ExpectationGap.gap_assessment from thesis; write to decision.gap_assessment):
- If gap_assessment is "Limited":
  - decision.rating must NOT be Strong Buy
  - If decision.rating is Buy, overall_conclusion opening MUST note "(limited expectation gap)" / "（预期差有限）"
  - Use the upper bound of Bear Case downside range in decision.bear_case_downside
- If gap_assessment is "Significant" AND decision.confidence_score is 5:
  - Strong Buy is allowed, but bullet_points MUST list verification milestones and stop-loss conditions`;

export const buildExpectationGapRatingRules = (isChinese: boolean): string =>
  isChinese ? EXPECTATION_GAP_RATING_RULES_CN : EXPECTATION_GAP_RATING_RULES_EN;

export type FinalConclusionPromptVariant = 'initial' | 'follow_up';

const FOLLOW_UP_OVERLAY_CN = `
跟进分析额外要求：
- 步骤一 Bear Case 须结合「上次分析快照」：若自上次分析以来风险升高/降低，须在 decision.bear_case_conditions 中明确说明。
- decision.thesis_invalidation 须聚焦自上次分析以来的变化。
- overall_conclusion 须对比上次 baseline 中的股价/PE/结论，但仍保持 prose 风格（禁止 【】 分段）。
- 评级决策后，须在 "vs_prior" 中说明相对上次评级是 upgrade / maintain / downgrade。`;

const FOLLOW_UP_OVERLAY_EN = `
Follow-up additional requirements:
- Step 1 Bear Case MUST reference the prior analysis snapshot in decision.bear_case_conditions; state if risks increased or decreased since then.
- decision.thesis_invalidation MUST focus on changes since the prior analysis.
- overall_conclusion MUST compare to prior baseline price/PE/conclusion while staying prose-only (no 【】 sections).
- After the matrix rating, document upgrade / maintain / downgrade vs the prior rating in "vs_prior".`;

const FOLLOW_UP_BULLET_OVERLAY_CN = `
- 每条 bullet 在相关时应体现自上次分析以来的变化（相对 baseline）。`;

const FOLLOW_UP_BULLET_OVERLAY_EN = `
- Each bullet should highlight changes since the prior analysis (vs baseline) where relevant.`;

export const buildOverallConclusionStyleRequirements = (isChinese: boolean): string =>
  isChinese ? OVERALL_CONCLUSION_STYLE_BLOCK_CN : OVERALL_CONCLUSION_STYLE_BLOCK_EN;

export const buildBearCaseAndRatingRequirements = (
  isChinese: boolean,
  variant: FinalConclusionPromptVariant = 'initial'
): string => {
  const base = isChinese ? BEAR_CASE_AND_RATING_BLOCK_CN : BEAR_CASE_AND_RATING_BLOCK_EN;
  if (variant === 'follow_up') {
    return `${base}${isChinese ? FOLLOW_UP_OVERLAY_CN : FOLLOW_UP_OVERLAY_EN}`;
  }
  return base;
};

export const buildFinalConclusionBulletRequirements = (
  isChinese: boolean,
  marketContextRule = '',
  variant: FinalConclusionPromptVariant = 'initial'
): string => {
  const template = isChinese ? BULLET_POINTS_BLOCK_CN : BULLET_POINTS_BLOCK_EN;
  const overlay =
    variant === 'follow_up'
      ? isChinese
        ? FOLLOW_UP_BULLET_OVERLAY_CN
        : FOLLOW_UP_BULLET_OVERLAY_EN
      : '';
  return template.replace('{marketContextRule}', marketContextRule) + overlay;
};


const formatThesisContext = (conclusion: InvestmentConclusion): Record<string, unknown> =>
  Object.fromEntries(
    THESIS_SECTION_KEYS.map(key => [
      key,
      {
        ...(key === 'ExpectationGap' && conclusion[key]?.gap_assessment
          ? { gap_assessment: conclusion[key]?.gap_assessment }
          : {}),
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
  supplementalQna: CompressibleQnA[] = [],
  marketContext?: string,
  materialEventsDigest?: string
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const jsonExample = isChinese ? FINAL_CONCLUSION_JSON_EXAMPLE_CN : FINAL_CONCLUSION_JSON_EXAMPLE_EN;
  const thesisContext = formatThesisContext(conclusion);
  const qnaDigest = supplementalQna.length ? formatTopicCompressedQnaDigest(supplementalQna, 800) : undefined;

  const marketContextRule = marketContext
    ? isChinese
      ? '- 当前价格/估值：使用 VERIFIED MARKET SNAPSHOT ONLY — 禁止引用拆股前或陈旧网页价格作为当前价位。'
      : '- For current price / valuation framing, use the VERIFIED MARKET SNAPSHOT ONLY — never cite pre-split or stale web prices as the current level.'
    : '';

  const bearCaseBlock = buildBearCaseAndRatingRequirements(isChinese, 'initial');
  const overallStyleBlock = isChinese ? OVERALL_CONCLUSION_STYLE_BLOCK_CN : OVERALL_CONCLUSION_STYLE_BLOCK_EN;
  const bulletBlock = buildFinalConclusionBulletRequirements(isChinese, marketContextRule, 'initial');
  const gapRatingRules = isChinese ? EXPECTATION_GAP_RATING_RULES_CN : EXPECTATION_GAP_RATING_RULES_EN;

  return `You are a senior investment analyst. Based on the investment thesis below for "${companyName}", provide a final, decisive investment conclusion in ${outputLanguage}.

HARD REQUIREMENTS (must follow exactly):
- Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
${bearCaseBlock}
${overallStyleBlock}
${bulletBlock}
${gapRatingRules}

Required JSON shape (follow this structure exactly):
${jsonExample}

${marketContext ? `${marketContext}\n\n` : ''}Investment thesis (8 sections — ExpectationGap is critical; use it for Bear Case and rating):
${JSON.stringify(thesisContext)}

${qnaDigest ? `Supplemental topic-compressed Q&A digest:\n${JSON.stringify(qnaDigest)}\n` : ''}
${materialEventsDigest ? `${materialEventsDigest}\n` : ''}
${recencyGuidance}

Respond ONLY with a valid JSON object matching the required shape above.`;
};
