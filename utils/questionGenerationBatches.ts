/** Per-batch LLM timeout for question generation (thinking mode can exceed 120s). */
export const QUESTION_GENERATION_BATCH_TIMEOUT_MS = 210_000;

/** Batch size for LLM question generation (avoids long single-call timeouts with thinking mode). */
export const QUESTION_GENERATION_BATCH_SIZE = 5;

export const RESEARCH_QUESTION_DIMENSIONS = [
  'Supply chain / upstream inputs and resilience',
  'Market position, share, and competitive dynamics',
  'Business model and revenue mix',
  'Financials (profitability, cash flow, balance sheet)',
  'Growth drivers and strategic catalysts',
  'Competitive advantages / moat',
  'Key risks and downside scenarios',
  'Management quality, capital allocation, and governance',
  'Recent news and near-term events (last 2-3 months)',
  'Valuation vs peers and historical ranges',
  'Market sentiment (flows, narrative, policy, earnings surprises)',
  'Industry cycle phase and position vs peers',
] as const;

export const RESEARCH_QUESTION_DIMENSIONS_CN = [
  '供应链 / 上游资源与供给韧性',
  '市场地位、份额与竞争格局',
  '商业模式与收入结构',
  '财务表现（盈利、现金流、资产负债表）',
  '增长驱动与战略催化剂',
  '竞争优势 / 护城河',
  '关键风险与下行情景',
  '管理层、资本配置与公司治理',
  '近期新闻与近 2–3 个月事件',
  '估值水平（相对同行与历史区间）',
  '市场情绪（资金、叙事、政策、业绩预期）',
  '行业周期阶段及相对同业位置',
] as const;

export const getResearchQuestionDimensions = (
  lang: 'cn' | 'en'
): readonly string[] =>
  lang === 'cn' ? RESEARCH_QUESTION_DIMENSIONS_CN : RESEARCH_QUESTION_DIMENSIONS;

export const FOLLOW_UP_QUESTION_THEMES = [
  'Price & valuation reset since prior analysis',
  'Thesis validation vs prior bull/bear points',
  'New financial disclosures since prior analysis',
  'Material events (M&A, management, products, regulation, litigation)',
  'Industry & cycle shift',
  'Market sentiment & analyst revisions',
  'New risks or risk resolution',
  'Actionable verdict support (buy/hold/sell vs prior conclusion)',
] as const;

export const FOLLOW_UP_QUESTION_THEMES_CN = [
  '股价与估值相对上次分析的变化',
  '投资论点验证：上次多空要点是否被证实、削弱或推翻',
  '上次分析以来的新财务披露（业绩、指引、现金流）',
  '重大事件（并购、管理层、产品、监管、诉讼、供需冲击）',
  '行业与周期变化',
  '市场情绪与分析师预期调整',
  '新风险出现或既有风险化解',
  '相对上次结论的买卖持有决策依据',
] as const;

export const getFollowUpQuestionThemes = (
  lang: 'cn' | 'en'
): readonly string[] =>
  lang === 'cn' ? FOLLOW_UP_QUESTION_THEMES_CN : FOLLOW_UP_QUESTION_THEMES;

export function splitQuestionCount(
  totalCount: number,
  batchSize = QUESTION_GENERATION_BATCH_SIZE
): number[] {
  const safeTotal = Math.max(1, Math.floor(totalCount));
  const safeBatch = Math.max(1, Math.floor(batchSize));
  const batches: number[] = [];
  let remaining = safeTotal;
  while (remaining > 0) {
    const size = Math.min(safeBatch, remaining);
    batches.push(size);
    remaining -= size;
  }
  return batches;
}

export function getDimensionIndexRange(
  batchIndex: number,
  batchTotal: number,
  totalDimensions: number
): { start: number; end: number } {
  if (batchTotal <= 0 || totalDimensions <= 0) {
    return { start: 1, end: totalDimensions };
  }
  const start = Math.floor((batchIndex * totalDimensions) / batchTotal) + 1;
  const end = Math.floor(((batchIndex + 1) * totalDimensions) / batchTotal);
  return { start, end: Math.max(end, start) };
}

export function formatBatchDedupHint(
  batchIndex: number,
  batchTotal: number,
  priorQuestionCount: number,
  dimensionRange: { start: number; end: number },
  lang: 'cn' | 'en' = 'en'
): string {
  if (batchTotal <= 1) return '';
  const priorBatchCount = batchIndex;
  if (lang === 'cn') {
    const lines = [
      `本批次覆盖研究维度序号 ${dimensionRange.start}–${dimensionRange.end}（见下方列表）。`,
    ];
    if (priorQuestionCount > 0) {
      lines.push(
        `前 ${priorBatchCount} 批已生成 ${priorQuestionCount} 个问题；本批须全部为新问题。`,
        `不得重复或改写维度 1–${dimensionRange.start - 1} 已覆盖的角度。`
      );
    }
    return `\n${lines.join('\n')}\n`;
  }

  const lines = [
    `This batch covers coverage dimension indices ${dimensionRange.start}–${dimensionRange.end} (see list below).`,
  ];
  if (priorQuestionCount > 0) {
    lines.push(
      `${priorQuestionCount} question(s) already generated in ${priorBatchCount} prior batch(es); produce only NEW questions.`,
      `Do not repeat or closely paraphrase angles from dimension indices 1–${dimensionRange.start - 1}.`
    );
  }
  return `\n${lines.join('\n')}\n`;
}

export function getCoverageSliceForBatch(
  batchIndex: number,
  batchTotal: number,
  labels: readonly string[]
): string[] {
  if (batchTotal <= 0 || labels.length === 0) return [];
  const start = Math.floor((batchIndex * labels.length) / batchTotal);
  const end = Math.floor(((batchIndex + 1) * labels.length) / batchTotal);
  return labels.slice(start, Math.max(end, start + 1));
}

export function dedupeQuestions(questions: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const question of questions) {
    const trimmed = question?.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** Max retries when a batch returns fewer valid questions than requested. */
export const QUESTION_GENERATION_MAX_BATCH_ATTEMPTS = 3;

/** Max extra rounds after dedupe if total count is still below target. */
export const QUESTION_GENERATION_MAX_TOPUP_ROUNDS = 3;

export async function generateQuestionsInBatches(
  totalCount: number,
  generateBatch: (
    batchSize: number,
    batchIndex: number,
    batchTotal: number,
    priorQuestionCount: number
  ) => Promise<string[]>,
  options?: {
    batchSize?: number;
    onBatchComplete?: (allQuestions: string[], batchIndex: number, batchTotal: number) => void;
  }
): Promise<string[]> {
  const batches = splitQuestionCount(totalCount, options?.batchSize);
  const defaultBatchSize = options?.batchSize ?? QUESTION_GENERATION_BATCH_SIZE;
  const allQuestions: string[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchSize = batches[batchIndex];
    let batchQuestions: string[] = [];
    let attempts = 0;

    while (batchQuestions.length < batchSize && attempts < QUESTION_GENERATION_MAX_BATCH_ATTEMPTS) {
      const need = batchSize - batchQuestions.length;
      const fetched = await generateBatch(
        need,
        batchIndex,
        batches.length,
        allQuestions.length + batchQuestions.length
      );
      batchQuestions = dedupeQuestions([
        ...batchQuestions,
        ...(Array.isArray(fetched) ? fetched : []),
      ]).slice(0, batchSize);
      attempts += 1;
    }

    if (batchQuestions.length < batchSize) {
      console.warn(
        `[question-generation] batch ${batchIndex + 1}/${batches.length}: expected ${batchSize}, got ${batchQuestions.length}`
      );
    }

    allQuestions.push(...batchQuestions);
    options?.onBatchComplete?.(allQuestions, batchIndex, batches.length);
  }

  let unique = dedupeQuestions(allQuestions);
  let topUpRound = 0;

  while (
    unique.length < totalCount &&
    topUpRound < QUESTION_GENERATION_MAX_TOPUP_ROUNDS
  ) {
    const need = totalCount - unique.length;
    const fetched = await generateBatch(
      Math.min(need, defaultBatchSize),
      batches.length + topUpRound,
      batches.length + QUESTION_GENERATION_MAX_TOPUP_ROUNDS,
      unique.length
    );
    unique = dedupeQuestions([
      ...unique,
      ...(Array.isArray(fetched) ? fetched : []),
    ]);
    topUpRound += 1;
  }

  if (unique.length < totalCount) {
    console.warn(
      `[question-generation] expected ${totalCount} questions, got ${unique.length} after top-up`
    );
  }

  return unique.slice(0, totalCount);
}
