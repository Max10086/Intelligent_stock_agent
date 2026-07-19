import type { Language } from '../types.ts';
import type { ThesisSectionKey } from './synthesizeConclusionPrompt.ts';
import { compressAnswerPreserveFacts, type CompressibleQnA } from './qnaTopicCompression.ts';
import { parseModelJsonResponse } from './modelJson.ts';

export type MaterialEventCategory =
  | 'partnership'
  | 'supply_chain'
  | 'catalyst'
  | 'regulatory'
  | 'product'
  | 'capital'
  | 'other';

export type MaterialEventStatus =
  | 'announced'
  | 'signed'
  | 'in_progress'
  | 'completed'
  | 'terminated'
  | 'uncertain';

export interface MaterialEvent {
  date?: string;
  headline: string;
  partners: string[];
  category: MaterialEventCategory;
  status: MaterialEventStatus;
  investment_relevance: string;
}

const VALID_CATEGORIES = new Set<MaterialEventCategory>([
  'partnership',
  'supply_chain',
  'catalyst',
  'regulatory',
  'product',
  'capital',
  'other',
]);

const VALID_STATUSES = new Set<MaterialEventStatus>([
  'announced',
  'signed',
  'in_progress',
  'completed',
  'terminated',
  'uncertain',
]);

const formatQnaForExtraction = (qna: CompressibleQnA[]): string =>
  JSON.stringify(
    qna.map((item, index) => ({
      id: index + 1,
      q: item.question,
      a: compressAnswerPreserveFacts(item.answer, 2200),
    }))
  );

export const buildMaterialEventsExtractPrompt = (
  companyName: string,
  lang: Language,
  qna: CompressibleQnA[]
): string => {
  const isChinese = lang === 'cn';
  const qnaBlock = formatQnaForExtraction(qna);

  if (isChinese) {
    return `你是投研助理。请从下列关于「${companyName}」的全部 Q&A 中，抽取**可能改变投资论点**的重大事件清单（含战略合作/MoU/合资、供应链绑定、产线通线、送样、监管、回购、并购等）。

规则：
- 只保留 Q&A 中有依据的事件；禁止臆造。
- 每条事件必须含：date（YYYY-MM-DD 或 YYYY-MM，未知则省略）、headline（一句话）、partners（合作方/监管方/客户数组，无则 []）、category、status、investment_relevance（1-2句投资含义）。
- category 只能是：partnership | supply_chain | catalyst | regulatory | product | capital | other
- status 只能是：announced | signed | in_progress | completed | terminated | uncertain
- 合作方名称须完整（如「康宁公司 / Corning Incorporated」），不要省略。
- 若 Q&A 明确写「过去90天无重大合作/事件」，返回空数组 events: []。

返回 ONLY JSON：
{"events":[{"date":"2026-05-20","headline":"...","partners":["..."],"category":"partnership","status":"signed","investment_relevance":"..."}]}

Q&A：
${qnaBlock}`;
  }

  return `You are an equity research assistant. From ALL Q&A below about "${companyName}", extract a list of **material events** that could change the investment thesis (strategic deals/MoU/JVs, supply-chain binding, line ramp, sampling, regulatory actions, buybacks, M&A, etc.).

Rules:
- Only include events supported by the Q&A; do NOT invent facts.
- Each event: date (YYYY-MM-DD or YYYY-MM, omit if unknown), headline (one line), partners (array; [] if none), category, status, investment_relevance (1-2 sentences).
- category: partnership | supply_chain | catalyst | regulatory | product | capital | other
- status: announced | signed | in_progress | completed | terminated | uncertain
- Use full counterparty names (e.g., "Corning Incorporated").
- If Q&A states no material deals/events in the window, return {"events":[]}.

Return ONLY JSON:
{"events":[{"date":"2026-05-20","headline":"...","partners":["..."],"category":"partnership","status":"signed","investment_relevance":"..."}]}

Q&A:
${qnaBlock}`;
};

export const normalizeMaterialEvents = (raw: unknown): MaterialEvent[] => {
  const eventsRaw = (raw as { events?: unknown })?.events;
  if (!Array.isArray(eventsRaw)) return [];

  const normalized: MaterialEvent[] = [];
  for (const item of eventsRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const headline = String(row.headline || row.event || row.title || '').trim();
    if (!headline) continue;

    const categoryRaw = String(row.category || 'other').trim() as MaterialEventCategory;
    const statusRaw = String(row.status || 'uncertain').trim() as MaterialEventStatus;
    const partnersRaw = row.partners ?? row.counterparties ?? row.parties ?? [];

    normalized.push({
      date: String(row.date || row.event_date || '').trim() || undefined,
      headline,
      partners: Array.isArray(partnersRaw)
        ? partnersRaw.map(p => String(p || '').trim()).filter(Boolean)
        : String(partnersRaw || '')
            .split(/[,、;；]/)
            .map(p => p.trim())
            .filter(Boolean),
      category: VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'other',
      status: VALID_STATUSES.has(statusRaw) ? statusRaw : 'uncertain',
      investment_relevance: String(
        row.investment_relevance || row.relevance || row.implication || ''
      ).trim(),
    });
  }
  return normalized;
};

export const parseMaterialEventsResponse = (text: string): MaterialEvent[] =>
  normalizeMaterialEvents(parseModelJsonResponse(text || '{}'));

const SECTION_EVENT_CATEGORIES: Partial<Record<ThesisSectionKey, MaterialEventCategory[]>> = {
  UpstreamSupplyChain: ['partnership', 'supply_chain'],
  OutlookRisks: ['partnership', 'catalyst', 'regulatory', 'product'],
  BusinessModel: ['partnership', 'product', 'supply_chain'],
};

export const filterMaterialEventsForSection = (
  events: MaterialEvent[],
  sectionKey: ThesisSectionKey
): MaterialEvent[] => {
  const allowed = SECTION_EVENT_CATEGORIES[sectionKey];
  if (!allowed) return [];
  return events.filter(event => allowed.includes(event.category));
};

export const buildMaterialEventsPromptBlock = (
  events: MaterialEvent[],
  sectionKey: ThesisSectionKey,
  lang: Language
): string => {
  const scoped = filterMaterialEventsForSection(events, sectionKey);
  if (!scoped.length) return '';

  const isChinese = lang === 'cn';
  const header = isChinese
    ? `【重大事件抽取清单 — 本节必须覆盖】
以下事件从全部 Q&A 交叉抽取。你必须在本节 summary 与 evidence 中体现每一条（合作方名称、日期、进展不可省略）；partnership/supply_chain 类事件至少各占一条 evidence（若存在）。`
    : `[MATERIAL EVENTS EXTRACT — mandatory coverage]
The following events were cross-extracted from ALL Q&A. You MUST reflect each in this section's summary and evidence (keep counterparty names, dates, and status); include at least one evidence line per partnership/supply_chain event when present.`;

  return `${header}
${JSON.stringify(scoped, null, 2)}`;
};

export const buildMaterialEventsDigestForFinalConclusion = (
  events: MaterialEvent[],
  lang: Language
): string | undefined => {
  if (!events.length) return undefined;
  const isChinese = lang === 'cn';
  const header = isChinese
    ? '【重大事件清单（来自 Q&A 抽取，最终结论须体现具名合作方与日期）】'
    : '[Material events extract — final conclusion must reflect named counterparties and dates when present]';
  return `${header}\n${JSON.stringify(events, null, 2)}`;
};

export const extractMaterialEventsFromQna = async (options: {
  companyName: string;
  lang: Language;
  qna: CompressibleQnA[];
  callModel: (prompt: string) => Promise<string>;
}): Promise<MaterialEvent[]> => {
  const prompt = buildMaterialEventsExtractPrompt(options.companyName, options.lang, options.qna);
  const text = await options.callModel(prompt);
  return parseMaterialEventsResponse(text);
};
