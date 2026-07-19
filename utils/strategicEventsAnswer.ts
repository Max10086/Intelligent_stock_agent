import type { CompanyProfile, FollowUpBaseline, GroundingSource, Language } from '../types.ts';
import { getEquityMarket } from './companyDiscovery.ts';
import {
  buildCompanyIdentityBlock,
  buildSearchDisambiguationBlock,
  type CompanyIdentityProfile,
} from './companyIdentity.ts';
import { buildAnswerQuestionPrompt, buildVerifiedMarketContext } from './marketSnapshot.ts';
import { buildFollowUpAnswerPrompt } from './followUpPrompts.ts';
import { isUnusableSearchAnswer } from './qnaAnswerQuality.ts';

export type StrategicEventQuestionKind = 'partnership' | 'material_events';

/** Detect fixed strategic-event hard questions (initial + follow-up templates). */
export const classifyStrategicEventQuestion = (question: string): StrategicEventQuestionKind | null => {
  const text = (question || '').trim();
  if (!text) return null;

  const isMaterialEvents =
    /重大外部事件|material external events|产线通线|监管批复|回购\/增发|并购\/资产出售|capacity adds|line ramp|M&A\/divestitures/i.test(
      text
    );
  const isPartnership =
    /合作备忘录|MoU|memorandum of understanding|战略(?:合作|伙伴).*?(?:协议|签署|绑定)|合资\/联营|战略供应商|战略客户绑定|strategic cooperation agreements|JVs\/alliances|binding deals/i.test(
      text
    );

  if (isMaterialEvents && /可能改变投资论点|change the investment thesis/i.test(text)) {
    return 'material_events';
  }
  if (isPartnership) return 'partnership';
  return null;
};

export const buildPartnershipMandatorySearchQueries = (
  profile: CompanyIdentityProfile,
  lang: Language
): string[] => {
  const market = getEquityMarket(profile);
  const { name, ticker } = profile;

  const queries =
    lang === 'cn'
      ? [
          `${name} ${ticker} 合作备忘录`,
          `${name} 战略合作 签署 公告`,
          `${ticker} MoU 合作 签署`,
          `${name} 合资 联营 协议`,
          `${name} 战略伙伴 合作 公告`,
          `${name} 签署 备忘录`,
        ]
      : [
          `${name} ${ticker} memorandum of understanding MoU signed`,
          `${name} strategic partnership agreement announcement`,
          `${ticker} joint venture alliance cooperation`,
          `${name} press release partnership signed`,
        ];

  if (market === 'CN') {
    queries.push(
      `site:cninfo.com.cn ${ticker} 合作备忘录`,
      `site:cninfo.com.cn ${ticker} 战略合作`,
      `${name} ${ticker} 公告 合作备忘录`,
      `${name} 证券时报 合作备忘录`,
      `${name} 上海证券报 战略合作`
    );
  } else if (market === 'HK') {
    queries.push(
      `site:hkexnews.hk ${ticker} cooperation memorandum`,
      `${name} HKEX announcement strategic cooperation`
    );
  } else {
    queries.push(`${ticker} 8-K partnership memorandum`, `${name} SEC filing strategic alliance`);
  }

  return Array.from(new Set(queries.filter(Boolean)));
};

export const buildMaterialEventsMandatorySearchQueries = (
  profile: CompanyIdentityProfile,
  lang: Language
): string[] => {
  const market = getEquityMarket(profile);
  const { name, ticker } = profile;

  const queries =
    lang === 'cn'
      ? [
          `${name} ${ticker} 公告 投产 通线`,
          `${name} 监管 批复 公告`,
          `${name} 回购 公告`,
          `${name} 并购 收购 公告`,
          `${name} 送样 量产 公告`,
          `${ticker} 重大事件 公告`,
        ]
      : [
          `${name} ${ticker} announcement ramp production`,
          `${name} regulatory approval filing`,
          `${name} buyback offering announcement`,
          `${ticker} acquisition divestiture announcement`,
        ];

  if (market === 'CN') {
    queries.push(`site:cninfo.com.cn ${ticker} 公告`, `${name} ${ticker} 巨潮资讯 公告`);
  } else if (market === 'HK') {
    queries.push(`site:hkexnews.hk ${ticker} announcement`);
  } else {
    queries.push(`${ticker} 8-K material event`, `${name} press release announcement`);
  }

  return Array.from(new Set(queries.filter(Boolean)));
};

export const buildMandatorySearchQueries = (
  kind: StrategicEventQuestionKind,
  profile: CompanyIdentityProfile,
  lang: Language
): string[] =>
  kind === 'partnership'
    ? buildPartnershipMandatorySearchQueries(profile, lang)
    : buildMaterialEventsMandatorySearchQueries(profile, lang);

export const MAX_STRATEGIC_SEARCH_QUERIES = 8;

/** Resolved Doubao multi-search queries for strategic hard questions. */
export const resolveStrategicEventSearchQueries = (
  question: string,
  profile: CompanyIdentityProfile,
  lang: Language
): string[] | undefined => {
  const kind = classifyStrategicEventQuestion(question);
  if (!kind) return undefined;
  return buildMandatorySearchQueries(kind, profile, lang).slice(0, MAX_STRATEGIC_SEARCH_QUERIES);
};

const buildMandatorySearchBlock = (
  kind: StrategicEventQuestionKind,
  profile: CompanyIdentityProfile,
  lang: Language
): string => {
  const queries = buildMandatorySearchQueries(kind, profile, lang);
  const queryList = queries.map(q => `- 「${q}」`).join('\n');

  if (lang === 'cn') {
    const topic =
      kind === 'partnership'
        ? '战略合作 / 合作备忘录（MoU）/ 合资联营 / 战略绑定'
        : '重大外部事件（监管、产线、送样、回购、并购等）';
    return `【${topic} — 强制多轮检索（未完成前禁止下「无事件」结论）】
本题要求穷尽检索近期披露。单次搜索往往漏掉交易所公告或权威财经稿（如证券时报、上海证券报、新浪财经、巨潮资讯 cninfo.com.cn），因此：

硬性规则：
1. 在给出「未发现 / 未签署 / 无相关事件」结论之前，必须对上述每一条检索式分别执行独立 web 搜索（至少 ${Math.min(queries.length, 8)} 次），不可仅凭首轮 10 条结果下结论。
2. A 股须优先核对巨潮资讯 / 深交所·上交所公告；若财经媒体报道了公告内容（如「签署合作备忘录」），与官方公告同等有效，须写入答案。
3. 合作备忘录（MoU）即使后续正式协议尚未签署，只要公司已公告或权威媒体已报道，即算「已披露的重大战略合作」。
4. 若找到事件，必须写出：日期（YYYY-MM-DD）、合作方全称、合作领域、有效期/里程碑、当前进展、来源 URL 或媒体名。
5. 仅当完成全部强制检索式后仍无任何依据，才可声明「未发现」并列出已执行的检索式。

强制检索式（逐条搜索）：
${queryList}`;
  }

  const topic =
    kind === 'partnership'
      ? 'strategic partnerships / MoU / JVs / binding deals'
      : 'material external events (regulatory, ramp, sampling, buyback, M&A, etc.)';
  const list = queries.map(q => `- "${q}"`).join('\n');
  return `[${topic.toUpperCase()} — MANDATORY MULTI-PASS SEARCH (do NOT conclude "none" prematurely)]
This question requires exhaustive retrieval. A single search pass often misses exchange filings or wire reports.

Rules:
1. Before stating "no events found", run a SEPARATE web search for EACH query below (at least ${Math.min(queries.length, 8)} distinct searches).
2. For listed issuers, prioritize exchange filings / IR press releases; reputable financial press reporting an announced MoU counts as disclosed.
3. An MoU counts as a material strategic deal once announced — even if definitive agreements are still pending.
4. If found: date (YYYY-MM-DD), counterparty legal name, scope, term/milestones, status, source.
5. Only after all mandatory queries return no evidence may you state "none found" and list queries executed.

Mandatory queries (search each):
${list}`;
};

export const buildStrategicEventAnswerPrompt = (options: {
  question: string;
  profile: Pick<
    CompanyProfile,
    'name' | 'ticker' | 'exchange' | 'currentPrice' | 'peTtm' | 'marketCap' | 'currency' | 'quoteTime'
  >;
  outputLanguage: string;
  recencyGuidance: string;
  lang: Language;
  kind: StrategicEventQuestionKind;
  followUpBaseline?: FollowUpBaseline;
}): string => {
  const base = options.followUpBaseline
    ? `${buildVerifiedMarketContext(options.profile, options.lang)}

${buildFollowUpAnswerPrompt(
  options.question,
  options.profile,
  options.outputLanguage,
  options.recencyGuidance,
  options.followUpBaseline
)}`
    : buildAnswerQuestionPrompt(
        options.question,
        options.profile,
        options.outputLanguage,
        options.recencyGuidance,
        options.lang
      );

  return `${base}

${buildMandatorySearchBlock(options.kind, options.profile, options.lang)}`;
};

export const buildAnswerPromptForQuestion = (options: {
  question: string;
  profile: Pick<
    CompanyProfile,
    'name' | 'ticker' | 'exchange' | 'currentPrice' | 'peTtm' | 'marketCap' | 'currency' | 'quoteTime'
  >;
  outputLanguage: string;
  recencyGuidance: string;
  lang: Language;
  followUpBaseline?: FollowUpBaseline;
}): string => {
  const kind = classifyStrategicEventQuestion(options.question);
  if (!kind) {
    if (options.followUpBaseline) {
      return `${buildVerifiedMarketContext(options.profile, options.lang)}

${buildFollowUpAnswerPrompt(
  options.question,
  options.profile,
  options.outputLanguage,
  options.recencyGuidance,
  options.followUpBaseline
)}`;
    }
    return buildAnswerQuestionPrompt(
      options.question,
      options.profile,
      options.outputLanguage,
      options.recencyGuidance,
      options.lang
    );
  }
  return buildStrategicEventAnswerPrompt({ ...options, kind });
};

const NEGATIVE_CLAIM_PATTERNS: Record<StrategicEventQuestionKind, RegExp[]> = {
  partnership: [
    /未发现.*(?:合作|协议|MoU|备忘录)/,
    /未签署.*(?:合作|协议|MoU|备忘录)/,
    /无相关事件/,
    /确实无相关事件/,
    /没有.*签署.*(?:合作|协议|MoU)/,
    /no (?:major|material).*(?:cooperation|partnership|MoU|memorandum)/i,
    /did not (?:sign|disclose).*(?:cooperation|partnership|MoU)/i,
    /none found/i,
    /no relevant events/i,
  ],
  material_events: [
    /未发现.*重大外部事件/,
    /无.*重大外部事件/,
    /没有.*可能改变投资论点/,
    /no material external events/i,
    /no events that could change the investment thesis/i,
  ],
};

const POSITIVE_EVIDENCE_PATTERNS: Record<StrategicEventQuestionKind, RegExp[]> = {
  partnership: [
    /合作备忘录/,
    /MoU/i,
    /memorandum of understanding/i,
    /战略合作协议/,
    /签署.*合作/,
    /与.{1,24}(公司|集团|Corp|Inc|Ltd|Limited|Corporation).{0,20}(签署|达成|建立).{0,12}合作/,
    /joint venture/i,
    /strategic partnership/i,
  ],
  material_events: [
    /公告编号/,
    /通线|投产|点火/,
    /送样|量产/,
    /回购|增持|减持/,
    /并购|收购|资产出售/,
    /监管.*批复/,
    /announcement|filing|8-K/i,
  ],
};

export const hasStrategicEventEvidence = (
  answer: string,
  kind: StrategicEventQuestionKind
): boolean => {
  const text = (answer || '').trim();
  if (!text) return false;
  const hasSignal = POSITIVE_EVIDENCE_PATTERNS[kind].some(p => p.test(text));
  const hasDate = /20\d{2}[-年/]\d{1,2}/.test(text);
  return hasSignal && hasDate;
};

export const isLikelyFalseNegativeStrategicAnswer = (
  answer: string,
  kind: StrategicEventQuestionKind
): boolean => {
  const text = (answer || '').trim();
  if (!text) return false;
  if (hasStrategicEventEvidence(text, kind)) return false;
  return NEGATIVE_CLAIM_PATTERNS[kind].some(p => p.test(text));
};

export const buildStrategicEventFalseNegativeRetryAppendix = (
  kind: StrategicEventQuestionKind,
  profile: CompanyIdentityProfile,
  lang: Language
): string => {
  const queries = buildMandatorySearchQueries(kind, profile, lang);
  const queryBlock = queries.map(q => (lang === 'cn' ? `- 「${q}」` : `- "${q}"`)).join('\n');

  if (lang === 'cn') {
    return `

【严重错误 — 疑似漏检，必须重写】
上一版答案在未穷尽检索的情况下声称「未发现」相关事件。这对投资分析不可接受（常见漏检：A 股「合作备忘录」公告、权威财经媒体转载）。

请完全重写答案，并严格遵守：
1. 对下列每一条检索式执行独立 web 搜索，不得跳过。
2. 重点检索：巨潮资讯 cninfo.com.cn、证券时报、上海证券报、新浪财经、公司公告标题中含「合作备忘录」「战略合作」的条目。
3. 若找到 MoU/战略合作：必须写出合作方全称（如 Corning Incorporated / 康宁公司）、公告或报道日期、合作领域、有效期。
4. 禁止在未完成全部检索前再次声称「未发现」。

强制检索式：
${queryBlock}

${buildCompanyIdentityBlock(profile, lang)}
${buildSearchDisambiguationBlock(profile, lang)}`;
  }

  return `

[CRITICAL — likely missed disclosure; rewrite required]
The previous draft concluded "no events" without exhaustive search. This is unacceptable (common misses: MoU press releases, exchange filings, wire copies).

Rewrite and:
1. Run a SEPARATE web search for EACH query below.
2. Prioritize exchange filings, IR releases, and major financial press.
3. If an MoU/partnership exists: counterparty legal name, announcement date, scope, term.
4. Do NOT claim "none found" until all queries below are tried.

Mandatory queries:
${queryBlock}

${buildCompanyIdentityBlock(profile, lang)}
${buildSearchDisambiguationBlock(profile, lang)}`;
};

export const applyStrategicEventAnswerRetries = async (options: {
  question: string;
  company: CompanyProfile;
  lang: Language;
  basePrompt: string;
  initial: { answer: string; sources: GroundingSource[] };
  callSearch: (prompt: string) => Promise<{ answer: string; sources: GroundingSource[] }>;
}): Promise<{ answer: string; sources: GroundingSource[] }> => {
  const kind = classifyStrategicEventQuestion(options.question);
  if (!kind) return options.initial;

  let { answer, sources } = options.initial;

  if (!isLikelyFalseNegativeStrategicAnswer(answer, kind)) {
    return { answer, sources };
  }

  console.warn(
    `[strategicEvents] False-negative retry (${kind}) for ${options.company.ticker}`
  );

  const retryPrompt = `${options.basePrompt}${buildStrategicEventFalseNegativeRetryAppendix(
    kind,
    options.company,
    options.lang
  )}`;
  const retry = await options.callSearch(retryPrompt);

  if (isUnusableSearchAnswer(retry.answer)) {
    return { answer, sources };
  }

  const retryHasEvidence = hasStrategicEventEvidence(retry.answer, kind);
  const initialHasEvidence = hasStrategicEventEvidence(answer, kind);

  if (retryHasEvidence && !initialHasEvidence) {
    return retry;
  }
  if (retryHasEvidence && initialHasEvidence) {
    return retry.sources.length >= sources.length ? retry : { answer, sources };
  }
  if (retry.sources.length > sources.length + 2) {
    return retry;
  }

  return { answer, sources };
};
