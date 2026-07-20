import type { CompanyProfile, Language } from '../types.ts';
import { getEquityMarket } from './companyDiscovery.ts';
import type { CninfoFetchSpec, CninfoFilingBundle, CninfoReportKind, CninfoReportPayload } from '../types/cninfo.ts';

const PRIORITY_SECTION_PATTERNS: RegExp[] = [
  /主要会计数据和财务指标/,
  /主要财务指标/,
  /主要会计数据/,
  /公司简介和主要财务指标/,
  /经营情况讨论与分析/,
  /管理层讨论与分析/,
  /报告期内公司所处行业情况/,
  /报告期内公司从事的主要业务/,
  /核心竞争力分析/,
  /主营业务分析/,
  /合并利润表/,
  /合并资产负债表/,
  /合并现金流量表/,
  /财务报表/,
];

const KIND_LABEL: Record<CninfoReportKind, { cn: string; en: string }> = {
  annual: { cn: '年报', en: 'Annual report' },
  q1: { cn: '一季报', en: 'Q1 report' },
  h1: { cn: '半年报', en: 'Interim report' },
  q3: { cn: '三季报', en: 'Q3 report' },
};

export const normalizeAShareSecCode = (ticker: string): string | null => {
  const raw = (ticker || '').trim().toUpperCase();
  const base = raw.replace(/\.(SH|SZ|SS|BJ)$/i, '').replace(/^(SH|SZ)/, '');
  return /^\d{6}$/.test(base) ? base : null;
};

export const guessCninfoPlate = (secCode: string): 'sz' | 'sh' | 'bj' => {
  const head = secCode[0];
  if (head === '0' || head === '3') return 'sz';
  if (head === '6') return 'sh';
  return 'bj';
};

export const isAShareProfile = (
  profile: Pick<CompanyProfile, 'ticker' | 'exchange'>
): boolean => getEquityMarket(profile) === 'CN';

const getLatestDisclosedQuarter = (date: Date) => {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month <= 4) return { year: year - 1, quarter: 4 as const };
  if (month <= 7) return { year, quarter: 1 as const };
  if (month <= 10) return { year, quarter: 2 as const };
  return { year, quarter: 3 as const };
};

export const buildCninfoPrefetchPlan = (now = new Date()): CninfoFetchSpec[] => {
  const latestAnnualYear = now.getFullYear() - 1;
  const { year: quarterYear, quarter } = getLatestDisclosedQuarter(now);

  const fetches: CninfoFetchSpec[] = [{ year: latestAnnualYear, kind: 'annual' }];

  if (quarter === 1) {
    fetches.push({ year: quarterYear, kind: 'q1' });
  } else if (quarter === 2) {
    fetches.push({ year: quarterYear, kind: 'h1' });
  } else if (quarter === 3) {
    fetches.push({ year: quarterYear, kind: 'q3' });
  }

  return fetches;
};

const splitMarkdownSections = (body: string): Array<{ title: string; content: string }> => {
  const lines = body.split(/\r?\n/);
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = '正文';
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ title: currentTitle, content });
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^第[一二三四五六七八九十]+节\s*(.+)$/);
    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
};

const scoreSection = (title: string, content: string): number => {
  let score = Math.min(content.length / 400, 8);
  for (let index = 0; index < PRIORITY_SECTION_PATTERNS.length; index += 1) {
    if (PRIORITY_SECTION_PATTERNS[index].test(title) || PRIORITY_SECTION_PATTERNS[index].test(content.slice(0, 400))) {
      score += 20 - index;
    }
  }
  return score;
};

export const extractFilingExcerpt = (body: string, maxChars: number): string => {
  const normalized = (body || '').replace(/\r/g, '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;

  const sections = splitMarkdownSections(normalized);
  const ranked = sections
    .map(section => ({ ...section, score: scoreSection(section.title, section.content) }))
    .sort((a, b) => b.score - a.score);

  const chunks: string[] = [];
  let used = 0;
  for (const section of ranked) {
    const header = section.title ? `【${section.title}】\n` : '';
    const block = `${header}${section.content}`.trim();
    if (!block) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    if (block.length <= remaining) {
      chunks.push(block);
      used += block.length + 2;
      continue;
    }
    chunks.push(`${block.slice(0, remaining)}\n…（节选截断）`);
    break;
  }

  if (chunks.length === 0) {
    return `${normalized.slice(0, maxChars)}\n…（节选截断）`;
  }
  return chunks.join('\n\n');
};

export const buildCninfoEvidenceText = (
  reports: CninfoReportPayload[],
  lang: Language,
  maxCharsPerReport: number
): string => {
  if (!reports.length) return '';

  const blocks = reports.map(report => {
    const kindLabel = KIND_LABEL[report.kind][lang === 'cn' ? 'cn' : 'en'];
    const header =
      lang === 'cn'
        ? `来源：巨潮资讯 cninfo.com.cn | ${report.title} | 披露日期 ${report.annDate} | ${kindLabel}`
        : `Source: cninfo.com.cn | ${report.title} | filed ${report.annDate} | ${kindLabel}`;
    const excerpt = extractFilingExcerpt(report.body, maxCharsPerReport);
    return `${header}\n${excerpt}`;
  });

  return blocks.join('\n\n' + '-'.repeat(40) + '\n\n');
};

export const buildCninfoEvidencePromptBlock = (
  evidenceText: string,
  lang: Language
): string => {
  if (!evidenceText.trim()) return '';

  if (lang === 'cn') {
    return `【巨潮资讯法定披露原文 — 财报数字以此为准】
以下摘录自中国证监会指定信息披露平台巨潮资讯网(cninfo.com.cn)已下载并解析的定期报告原文。
规则：
1. 涉及营收、利润、现金流、资产负债、EPS、ROE、毛利率、费用率、分部数据等，必须优先引用以下原文；禁止用网页搜索中的二手媒体数字覆盖原文。
2. 若原文未覆盖某指标，可补充搜索，但须标注「原文未披露」或「来自其他来源」。
3. 引用须标注报告类型与披露日期（如 2024年报 / 2024-10-30 三季报）。
4. 网页搜索仅用于补充近期新闻、政策、行业动态，不得与原文财务数字冲突；冲突时以原文为准。

${evidenceText}`;
  }

  return `[CNINFO OFFICIAL FILING EXCERPTS — primary source for financial figures]
The following text is extracted from periodic reports downloaded and parsed from cninfo.com.cn (China's statutory disclosure platform).
Rules:
1. For revenue, profit, cash flow, balance sheet items, EPS, ROE, margins, segment data, etc., cite these excerpts FIRST — do NOT override with secondary web search figures.
2. If a metric is missing below, you may use search but must label it as "not in filing excerpt" or "from other source".
3. Always label report type and filing date (e.g. FY2024 annual / Q3 filed 2024-10-30).
4. Web search is for recent news/policy/industry context only; on numeric conflicts, filing excerpts win.

${evidenceText}`;
};

export const buildCninfoFilingBundle = (params: {
  secCode: string;
  plate: 'sz' | 'sh' | 'bj';
  reports: CninfoReportPayload[];
  errors: CninfoFilingBundle['errors'];
  lang: Language;
  maxCharsPerReport?: number;
}): CninfoFilingBundle => {
  const maxCharsPerReport = params.maxCharsPerReport ?? readMaxCharsPerReport();
  const evidenceText = buildCninfoEvidenceText(params.reports, params.lang, maxCharsPerReport);
  return {
    secCode: params.secCode,
    plate: params.plate,
    reports: params.reports,
    errors: params.errors,
    evidenceText,
  };
};

export const readMaxCharsPerReport = (): number => {
  const raw = Number(process.env.CNINFO_MAX_CHARS_PER_REPORT || '6000');
  if (!Number.isFinite(raw) || raw <= 0) return 6000;
  return Math.min(Math.floor(raw), 20000);
};

export const readCninfoEnabled = (): boolean => {
  const flag = (process.env.CNINFO_ENABLED || 'true').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
};
