import { ThesisSectionKey, THESIS_SECTION_KEYS } from './synthesizeConclusionPrompt.ts';

export interface CompressibleQnA {
  question: string;
  answer: string;
  sources?: Array<{ title?: string; uri?: string }>;
}

export type TopicBucket = ThesisSectionKey | 'General';

const FACT_SENTENCE_PATTERN =
  /(\d{4}[\s年/-]?(Q[1-4]|((0?[1-9]|1[0-2])月))?|\d[\d,\.]*%|[¥$￥€]\s*[\d,\.]+|\d+(\.\d+)?\s*(亿|万千百|bps|pp|倍|元|美元|吨|台|次|米|股)|20\d{2}Q[1-4]|FY20\d{2}|H[12]\s*20\d{2})/i;

const SECTION_TOPIC_PATTERNS: Record<ThesisSectionKey, RegExp[]> = {
  UpstreamSupplyChain: [
    /供应|上游|原材料|供应链|采购|矿石|精矿|supplier|upstream|raw material|supply chain|input cost/i,
  ],
  MarketPosition: [
    /市场|份额|竞争|地位|定价|龙头|市占|market share|competitive|position|ranking|pricing power/i,
  ],
  BusinessModel: [
    /业务|模式|收入|产品|结构|垂直|整合|商业模式|business model|revenue mix|monetization|segment/i,
  ],
  Financials: [
    /财务|营收|利润|毛利|现金流|估值|PE|PB|ROE|EPS|earning|margin|cash flow|balance sheet|financial|资产负债/i,
  ],
  OutlookRisks: [
    /风险|展望|催化|政策|管理|监管|outlook|risk|catalyst|policy|management|guidance/i,
  ],
  MarketSentiment: [
    /情绪|叙事|资金|北向|机构|持仓|sentiment|narrative|flow|priced in|institutional|consensus/i,
  ],
  IndustryCycle: [
    /周期|行业|产能|利用率|景气|cycle|industry|utilization|trough|peak|supply.?demand/i,
  ],
  ExpectationGap: [
    /预期差|市场预期|刻板印象|定价框架|叙事|催化剂|里程碑|Bullish Expectation|Market Expectation|expectation gap|consensus|re-rating|stereotype|priced.?in|near.?term/i,
  ],
};

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[。！？；\.!?;])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

/** Keep sentences with numbers/dates first, then fill remaining budget with context sentences. */
export const compressAnswerPreserveFacts = (answer: string, maxChars = 1400): string => {
  const trimmed = (answer || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;

  const sentences = splitSentences(trimmed);
  const factSentences = sentences.filter(s => FACT_SENTENCE_PATTERN.test(s));
  const otherSentences = sentences.filter(s => !FACT_SENTENCE_PATTERN.test(s));

  let result = '';
  for (const sentence of factSentences) {
    const next = result ? `${result} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    result = next;
  }

  for (const sentence of otherSentences) {
    const next = result ? `${result} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    result = next;
  }

  if (result.length >= Math.min(trimmed.length, 200)) return result;
  return trimmed.slice(0, maxChars - 1) + '…';
};

export const classifyQuestionTopics = (question: string): TopicBucket[] => {
  const matched: TopicBucket[] = [];
  for (const key of THESIS_SECTION_KEYS) {
    if (SECTION_TOPIC_PATTERNS[key].some(pattern => pattern.test(question))) {
      matched.push(key);
    }
  }
  return matched.length > 0 ? matched : ['General'];
};

export const groupQnaByTopic = (
  qna: CompressibleQnA[]
): Record<TopicBucket, CompressibleQnA[]> => {
  const grouped = Object.fromEntries(
    [...THESIS_SECTION_KEYS, 'General'].map(key => [key, [] as CompressibleQnA[]])
  ) as Record<TopicBucket, CompressibleQnA[]>;

  for (const item of qna) {
    const topics = classifyQuestionTopics(item.question);
    for (const topic of topics) {
      grouped[topic].push(item);
    }
  }

  return grouped;
};

const formatCompressedItem = (item: CompressibleQnA, maxAnswerChars = 1400) => ({
  q: item.question,
  a: compressAnswerPreserveFacts(item.answer, maxAnswerChars),
  sources: (item.sources || [])
    .slice(0, 2)
    .map(source => source.title || source.uri)
    .filter((value): value is string => Boolean(value)),
});

/** Topic-grouped digest for integrate / final-conclusion prompts. */
export const formatTopicCompressedQnaDigest = (
  qna: CompressibleQnA[],
  maxAnswerChars = 1200
): Record<string, Array<{ q: string; a: string; sources?: string[] }>> => {
  const grouped = groupQnaByTopic(qna);
  const digest: Record<string, Array<{ q: string; a: string; sources?: string[] }>> = {};

  for (const key of [...THESIS_SECTION_KEYS, 'General'] as TopicBucket[]) {
    const items = grouped[key];
    if (!items.length) continue;
    digest[key] = items.map(item => formatCompressedItem(item, maxAnswerChars));
  }

  return digest;
};

/** Section-scoped Q&A: primary topic matches + compressed General fallback. */
export const formatQnaForSection = (
  qna: CompressibleQnA[],
  sectionKey: ThesisSectionKey,
  maxItems = 10,
  maxAnswerChars = 1400
): Array<{ q: string; a: string; sources?: string[] }> => {
  const grouped = groupQnaByTopic(qna);
  const primary = grouped[sectionKey].map(item => formatCompressedItem(item, maxAnswerChars));
  const general = grouped.General.map(item => formatCompressedItem(item, maxAnswerChars));

  const seen = new Set<string>();
  const merged: Array<{ q: string; a: string; sources?: string[] }> = [];

  for (const item of [...primary, ...general]) {
    if (seen.has(item.q)) continue;
    seen.add(item.q);
    merged.push(item);
    if (merged.length >= maxItems) break;
  }

  if (merged.length > 0) return merged;

  return qna.slice(0, maxItems).map(item => formatCompressedItem(item, maxAnswerChars));
};

/** Backward-compatible wrapper used by legacy full-thesis prompt builders. */
export const formatQnaForConclusion = (qna: CompressibleQnA[]) => {
  const digest = formatTopicCompressedQnaDigest(qna);
  return Object.entries(digest).flatMap(([, items]) => items);
};
