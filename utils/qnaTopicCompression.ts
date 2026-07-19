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

/** Additional signals from answer text (partnerships, announcements, etc.). */
const ANSWER_CONTENT_PATTERNS: Partial<Record<ThesisSectionKey, RegExp[]>> = {
  UpstreamSupplyChain: [
    /合作备忘录|战略合作协议|战略协议|MoU|memorandum of understanding|joint venture|合资|联营|战略伙伴|战略供应商|战略客户|签署.*合作|partner(?:ship)? with|collaborat/i,
    /与.{1,24}(公司|集团|Corp|Inc|Ltd|Limited|Corporation).{0,12}(签署|达成|建立).{0,12}合作/i,
  ],
  OutlookRisks: [
    /公告|披露|投资者关系|业绩说明|通线|投产|点火|送样|量产|获批|监管|回购|增持|减持|并购|收购|announcement|filing|IR activity|sample|ramp|mass production/i,
    /过去\s*90\s*个自然日|last\s*90\s*calendar\s*days|重大外部事件|material external event/i,
  ],
  BusinessModel: [
    /新业务|第[二三四N1-9]曲线|非显示|转型|新增长|new business|non-display|diversif|segment expansion/i,
  ],
  Financials: [
    /回购|注销|增发|配股|股息|buyback|repurchase|offering|dividend/i,
  ],
};

const SECTION_PRIORITY_PATTERNS: Partial<Record<ThesisSectionKey, RegExp[]>> = {
  UpstreamSupplyChain: [
    /合作|备忘录|MoU|partnership|合资|战略协议|counterparty|合作方/i,
  ],
  OutlookRisks: [
    /90\s*个自然日|90\s*calendar\s*days|重大事件|material event|catalyst|公告|announcement/i,
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

/** Route Q&A by question keywords AND answer content (partnerships, announcements, etc.). */
export const classifyQnaTopics = (question: string, answer: string): TopicBucket[] => {
  const fromQuestion = classifyQuestionTopics(question);
  const merged = new Set<ThesisSectionKey>();

  for (const topic of fromQuestion) {
    if (topic !== 'General') merged.add(topic);
  }

  for (const key of THESIS_SECTION_KEYS) {
    const patterns = ANSWER_CONTENT_PATTERNS[key];
    if (patterns?.some(pattern => pattern.test(answer))) {
      merged.add(key);
    }
  }

  if (merged.size === 0) return ['General'];
  return [...merged];
};

const scoreItemForSection = (item: CompressibleQnA, sectionKey: ThesisSectionKey): number => {
  const text = `${item.question}\n${item.answer}`;
  const patterns = SECTION_PRIORITY_PATTERNS[sectionKey] || [];
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) score += 2;
  }
  if (/合作方|counterpart|partners?|MoU|备忘录/.test(text)) score += 1;
  return score;
};

const prioritizeItemsForSection = (
  items: CompressibleQnA[],
  sectionKey: ThesisSectionKey
): CompressibleQnA[] => {
  const patterns = SECTION_PRIORITY_PATTERNS[sectionKey];
  if (!patterns?.length) return items;
  return [...items].sort(
    (a, b) => scoreItemForSection(b, sectionKey) - scoreItemForSection(a, sectionKey)
  );
};

export const groupQnaByTopic = (
  qna: CompressibleQnA[]
): Record<TopicBucket, CompressibleQnA[]> => {
  const grouped = Object.fromEntries(
    [...THESIS_SECTION_KEYS, 'General'].map(key => [key, [] as CompressibleQnA[]])
  ) as Record<TopicBucket, CompressibleQnA[]>;

  for (const item of qna) {
    const topics = classifyQnaTopics(item.question, item.answer);
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
  const primary = prioritizeItemsForSection(grouped[sectionKey], sectionKey).map(item =>
    formatCompressedItem(item, maxAnswerChars)
  );
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
