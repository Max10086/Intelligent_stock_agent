import type { FollowUpBaseline, InvestmentConclusion, Language } from '../types.ts';
import { THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';
import { formatTopicCompressedQnaDigest } from './qnaTopicCompression.ts';
import {
  formatBatchDedupHint,
  getCoverageSliceForBatch,
  getDimensionIndexRange,
  getFollowUpQuestionThemes,
} from './questionGenerationBatches.ts';

const formatBaselineContext = (baseline: FollowUpBaseline, lang: Language): string => {
  const date = baseline.analysisDate.slice(0, 10);
  const bullets =
    baseline.thesisBullets && baseline.thesisBullets.length > 0
      ? baseline.thesisBullets.map(item => `- ${item}`).join('\n')
      : lang === 'cn' ? '- （无记录）' : '- (none recorded)';

  if (lang === 'cn') {
    return `上次分析快照（${date}）：
- 上次股价：${baseline.price}
- 上次 PE（TTM）：${baseline.peTtm || 'N/A'}
- 上次市值：${baseline.marketCap || 'N/A'}
- 上次总体结论：${baseline.overallConclusion || 'N/A'}
上次核心论点：
${bullets}`;
  }

  return `Prior analysis snapshot (${date}):
- Prior price: ${baseline.price}
- Prior PE (TTM): ${baseline.peTtm || 'N/A'}
- Prior market cap: ${baseline.marketCap || 'N/A'}
- Prior overall conclusion: ${baseline.overallConclusion || 'N/A'}
Prior key thesis bullets:
${bullets}`;
};

const formatPriorThesisSummaries = (
  conclusion: InvestmentConclusion | null | undefined,
  lang: Language
): string => {
  if (!conclusion) {
    return lang === 'cn' ? '（无上次论点记录）' : '(no prior thesis recorded)';
  }
  return THESIS_SECTION_KEYS.map(key => {
    const section = conclusion[key];
    return `- ${key}: ${section?.summary || 'N/A'}`;
  }).join('\n');
};

export const buildFollowUpRecencyGuidance = (
  sinceDate: string,
  today: Date,
  lang: Language = 'en'
): string => {
  const todayStr = today.toISOString().slice(0, 10);
  const sinceStr = sinceDate.slice(0, 10);

  if (lang === 'cn') {
    return `今天是 ${todayStr}。
这是一次跟进分析。上次分析完成于 ${sinceStr}。

时间窗口硬性要求：
- 仅关注 ${sinceStr} 至 ${todayStr} 之间的变化、披露、新闻与市场动态。
- 除非事实发生重大变化，否则不要重复上次已覆盖的稳定基线信息。
- 若某维度自 ${sinceStr} 以来无实质变化，须明确写「自上次分析以来无重大变化」，并说明上次观点是否仍成立。
- 优先覆盖：${sinceStr} 之后的业绩/公告、重大事件、政策变化、股价/估值变动、情绪与行业周期变化。
关键论断须标注具体日期或期间（YYYY-MM 或 YYYY-Qx）。`;
  }

  return `Today is ${todayStr}.
This is a FOLLOW-UP analysis. The prior analysis was completed on ${sinceStr}.

STRICT TIME WINDOW:
- Focus ONLY on developments, disclosures, news, and market changes BETWEEN ${sinceStr} and ${todayStr}.
- Do NOT repeat stable baseline facts unless they materially changed.
- If a dimension has no meaningful change since ${sinceStr}, explicitly state "No material change since prior analysis" and explain why the prior view still holds or no longer holds.
- Prioritize: earnings/filings after ${sinceStr}, announcements, policy shifts, price/valuation moves, sentiment shifts, and industry cycle changes in this window.
Always include concrete dates or periods (YYYY-MM or YYYY-Qx) in key claims.`;
};

export const buildFollowUpQuestionsPrompt = (
  companyName: string,
  outputLanguage: string,
  questionCount: number,
  recencyGuidance: string,
  baseline: FollowUpBaseline,
  priorConclusion: InvestmentConclusion | null | undefined,
  batch?: {
    batchIndex: number;
    batchTotal: number;
    priorQuestionCount?: number;
  },
  strictLanguageRetry = false
): string => {
  const lang: Language = /chinese/i.test(outputLanguage) ? 'cn' : 'en';
  const themes = getFollowUpQuestionThemes(lang);

  const batchHeader =
    batch && batch.batchTotal > 1
      ? lang === 'cn'
        ? `这是第 ${batch.batchIndex + 1}/${batch.batchTotal} 批。请仅生成本批 ${questionCount} 个全新跟进问题。\n\n`
        : `This is batch ${batch.batchIndex + 1} of ${batch.batchTotal}. Generate exactly ${questionCount} NEW questions for this batch only.\n\n`
      : '';

  const batchThemes = batch
    ? getCoverageSliceForBatch(batch.batchIndex, batch.batchTotal, themes)
    : [...themes];

  const themeRange = batch
    ? getDimensionIndexRange(batch.batchIndex, batch.batchTotal, themes.length)
    : { start: 1, end: themes.length };

  const dedupHint = batch
    ? formatBatchDedupHint(
        batch.batchIndex,
        batch.batchTotal,
        batch.priorQuestionCount ?? 0,
        themeRange,
        lang
      )
    : '';

  const sinceDate = baseline.analysisDate.slice(0, 10);

  const themesBlock =
    lang === 'cn'
      ? batch
        ? `本批覆盖要求 — 须覆盖下列跟进主题：
${batchThemes.map((t, i) => `${themeRange.start + i}) ${t}`).join('\n')}`
        : `覆盖要求 — 须覆盖下列跟进主题：
1) 股价与估值相对上次分析的变化；当前价位是否仍有吸引力？
2) 论点验证：上次多空要点中哪些被证实、削弱或推翻？
3) 上次分析以来的新财务披露（业绩、指引、现金流）
4) 重大事件：并购、管理层、产品、监管、诉讼、供需冲击
5) 行业与周期：周期阶段或竞争格局是否变化？
6) 市场情绪：叙事、资金、分析师预期自上次分析以来的变化
7) 新风险出现或既有风险化解
8) 决策支持：相对上次结论，买入/持有/卖出需要哪些新证据？`
      : batch
        ? `Coverage requirements for this batch — include questions across these follow-up themes:
${batchThemes.map((t, i) => `${themeRange.start + i}) ${t}`).join('\n')}`
        : `Coverage requirements — include questions across these follow-up themes:
1) Price & valuation reset: what changed in stock price/PE since prior analysis; is the new price still attractive?
2) Thesis validation: which prior bull/bear points were confirmed, weakened, or invalidated since ${sinceDate}?
3) New financial disclosures: earnings, guidance, cash flow updates since prior analysis
4) Material events: M&A, management, products, regulation, litigation, supply/demand shocks
5) Industry & cycle shift: did the industry cycle phase or competitive landscape change?
6) Market sentiment: narrative, flows, analyst revisions since prior analysis
7) New risks or risk resolution since prior analysis
8) Actionable verdict support: evidence needed to decide buy/hold/sell vs the prior conclusion`;

  const languageRule =
    lang === 'cn'
      ? `【语言硬性要求】所有问题必须全部使用简体中文撰写。禁止输出英文问句或英文段落（可保留公司名、股票代码、YYYY-Qx、FYxxxx、百分比与数字）。`
      : `LANGUAGE REQUIREMENT: Every question must be written entirely in English.`;

  const depthBlock =
    lang === 'cn'
      ? `深度要求：
- 每个问题须明确引用自上次分析（${sinceDate}）以来的时间窗口。
- 避免泛泛的「商业模式是什么」类问题，除非业务模式已发生变化。
- 优先使用「自 ${sinceDate} 以来」「相较上次分析」「新出现/新披露」等表述。`
      : `Depth requirements:
- Each question must reference the time window since the prior analysis.
- Avoid generic "what is the business model" questions unless the model changed.
- Prefer "since [date]", "compared with prior analysis", "what newly emerged".`;

  const intro =
    lang === 'cn'
      ? `${batchHeader}请为「${companyName}」生成恰好 ${questionCount} 个跟进投资研究问题。输出语言：简体中文。

这不是首次深度研究，公司已被分析过。问题须聚焦：自上次分析以来发生了什么变化？在当前新价位/估值下，上次投资论点是否仍然成立？

${languageRule}`
      : `${batchHeader}Generate exactly ${questionCount} follow-up investment research questions in English about "${companyName}".

This is NOT a first-time deep dive. The company was already analyzed. Your questions must focus on WHAT CHANGED since the prior analysis and whether the prior investment thesis still holds at the NEW price/valuation.

${languageRule}`;

  const strictSuffix =
    lang === 'cn'
      ? '\n\n【重试】上一批含英文问题。本批每个问题必须整句中文，不得夹英文。'
      : '\n\nRETRY: Previous batch had wrong language. Every question must be English.';

  return `${intro}

${formatBaselineContext(baseline, lang)}

${lang === 'cn' ? '上次论点各维度摘要：' : 'Prior thesis section summaries:'}
${formatPriorThesisSummaries(priorConclusion, lang)}

${themesBlock}
${dedupHint}
${depthBlock}
${recencyGuidance}
${lang === 'cn' ? '仅返回 JSON：{"questions": ["...", ...]}' : 'Respond ONLY with a valid JSON object: {"questions": ["...", ...]}'}${strictLanguageRetry ? strictSuffix : ''}`;
};

export const buildFollowUpAnswerPrompt = (
  question: string,
  companyName: string,
  outputLanguage: string,
  recencyGuidance: string,
  baseline: FollowUpBaseline
): string => {
  const lang: Language = /chinese/i.test(outputLanguage) ? 'cn' : 'en';

  if (lang === 'cn') {
    return `作为金融分析师，请用简体中文回答关于「${companyName}」的以下跟进问题：「${question}」

${formatBaselineContext(baseline, lang)}

${recencyGuidance}

回答要求：
- 聚焦自上次分析日期以来的变化。
- 在相关处将新事实与上次结论对比。
- 若该主题无实质变化，须明确说明。
- 关键事实须标注期间（YYYY-Qx、YYYY-MM、FYxxxx）。
- 引用信息来源。`;
  }

  return `As a financial analyst, answer this FOLLOW-UP question about "${companyName}" in ${outputLanguage}: "${question}"

${formatBaselineContext(baseline, lang)}

${recencyGuidance}

Answer requirements:
- Focus on changes since the prior analysis date.
- Compare new facts with the prior conclusion when relevant.
- If nothing material changed on this topic, say so explicitly.
- Include period labels (YYYY-Qx, YYYY-MM, FYxxxx).
- Cite sources.`;
};

export const buildFollowUpPriorContextBlock = (
  baseline: FollowUpBaseline,
  priorConclusion: InvestmentConclusion | null | undefined,
  lang: Language = 'en'
): string => {
  if (lang === 'cn') {
    return `跟进分析背景（必须纳入）：
${formatBaselineContext(baseline, lang)}

上次论点摘要：
${formatPriorThesisSummaries(priorConclusion, lang)}

每个维度须说明：自上次分析以来观点是否变化及原因；无变化维度须明确标注。`;
  }

  return `FOLLOW-UP CONTEXT (must incorporate):
${formatBaselineContext(baseline, lang)}

Prior thesis summaries:
${formatPriorThesisSummaries(priorConclusion, lang)}

For each section, state whether the view changed since the prior analysis and why. Flag unchanged sections explicitly.`;
};

export const buildFollowUpFinalConclusionPrompt = (
  companyName: string,
  outputLanguage: string,
  recencyGuidance: string,
  baseline: FollowUpBaseline,
  conclusion: InvestmentConclusion,
  qna: Array<{ question: string; answer: string }>
): string => {
  const isChinese = /chinese/i.test(outputLanguage);
  const jsonExample = isChinese
    ? `{
  "overall_conclusion": "谨慎买入。较上次「持有」上调评级。\\n\\n自上次分析以来锂价反弹与2026Q1毛利修复支撑 thesis，但估值已部分反映周期复苏；需跟踪2026H2产能投放与现金流改善是否兑现。",
  "bullet_points": [
    {
      "argument": "自上次分析以来锂价与毛利率改善",
      "evidence": ["2026年5-6月碳酸锂现货反弹XX%", "2026Q1毛利率较2025Q4改善X个百分点"]
    },
    {
      "argument": "估值仍高于历史中位但较峰值回落",
      "evidence": ["当前PE TTM XX倍", "较2026年3月高点回落Y%"]
    }
  ],
  "vs_prior": {
    "prior_overall_conclusion": "持有。周期底部承压但自有矿占比提升提供中期成本优势。",
    "rating_change": "upgrade",
    "change_summary": "基本面边际改善且价格仍低于52周高点，风险收益比改善。"
  }
}`
    : `{
  "overall_conclusion": "Cautious Buy. Upgraded from prior Hold.\\n\\nMargin repair and lithium price rebound since the prior analysis support the thesis, but valuation partly prices in recovery; 2026H2 ramp and cash flow improvement must be verified.",
  "bullet_points": [
    {
      "argument": "Lithium price and gross margin improved since prior analysis",
      "evidence": ["Spot lithium rebounded XX% between May-Jun 2026", "2026Q1 gross margin improved X pp vs 2025Q4"]
    },
    {
      "argument": "Valuation remains above historical median but off recent peak",
      "evidence": ["PE TTM now XXx", "Down Y% from Mar 2026 peak"]
    }
  ],
  "vs_prior": {
    "prior_overall_conclusion": "Hold. Cycle trough pressure persists but captive mine share supports medium-term cost edge.",
    "rating_change": "upgrade",
    "change_summary": "Fundamentals inflected positively while price remains below 52-week high; risk-reward improved."
  }
}`;

  const thesisContext = Object.fromEntries(
    THESIS_SECTION_KEYS.map(key => [
      key,
      { summary: conclusion[key]?.summary || '', evidence: conclusion[key]?.evidence || [] },
    ])
  );
  const qnaDigest = formatTopicCompressedQnaDigest(qna, 800);
  const lang: Language = isChinese ? 'cn' : 'en';

  const header = isChinese
    ? `你是资深投资分析师，请用简体中文为「${companyName}」撰写跟进投资结论。`
    : `You are a senior investment analyst writing a FOLLOW-UP investment conclusion for "${companyName}" in ${outputLanguage}.`;

  const requirements = isChinese
    ? `硬性要求：
- 仅返回合法 JSON，不要 markdown 代码块。
- "overall_conclusion" 须分两段，用 \\n\\n 分隔：(1) 相对上次的最新评级；(2) 3–5 句聚焦自上次分析以来变化的执行摘要。
- "bullet_points" 须 5–7 条，聚焦自上次分析以来的变化；每条含 2–3 条证据字符串。
- 必须包含 "vs_prior" 对象：
  - "prior_overall_conclusion"：复述/概括上方上次结论
  - "rating_change"：upgrade / maintain / downgrade 之一
  - "change_summary"：1–2 句说明评级变动或维持的原因
- 结论须基于下方跟进投资论点。`
    : `HARD REQUIREMENTS:
- Return ONLY valid JSON. No markdown fences.
- "overall_conclusion" MUST have TWO parts separated by \\n\\n: (1) one-sentence NEW rating vs prior, (2) 3-5 sentence executive summary focused on changes since prior analysis.
- "bullet_points" MUST contain 5 to 7 items focused on changes since the prior analysis; each with 2-3 evidence strings.
- MUST include "vs_prior" object with:
  - "prior_overall_conclusion": copy/summarize the prior conclusion above
  - "rating_change": one of "upgrade", "maintain", "downgrade"
  - "change_summary": 1-2 sentences explaining why the rating changed or stayed the same
- Base the conclusion on the follow-up investment thesis below.`;

  const thesisLabel = isChinese ? '跟进投资论点：' : 'Follow-up investment thesis:';
  const qnaLabel = isChinese ? '主题压缩问答摘要：' : 'Topic-compressed Q&A digest:';
  const shapeLabel = isChinese ? 'JSON 结构示例：' : 'Required JSON shape:';

  return `${header}

${formatBaselineContext(baseline, lang)}

${recencyGuidance}

${requirements}

${shapeLabel}
${jsonExample}

${thesisLabel}
${JSON.stringify(thesisContext)}

${qnaLabel}
${JSON.stringify(qnaDigest)}`;
};
