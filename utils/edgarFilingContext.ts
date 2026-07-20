import type { CompanyProfile, Language } from '../types.ts';
import { getEquityMarket } from './companyDiscovery.ts';
import type { EdgarFetchSpec, EdgarFilingBundle, EdgarReportForm, EdgarReportPayload } from '../types/edgar.ts';

const PRIORITY_SECTION_PATTERNS: RegExp[] = [
  /Item 7/i,
  /Management.?s Discussion/i,
  /MD&A/i,
  /Part I,?\s*Item 2/i,
  /Item 1A/i,
  /Risk Factors/i,
  /Item 1[^0-9]/i,
  /Business/i,
  /Income Statement/i,
  /Balance Sheet/i,
  /Cash Flow/i,
  /Consolidated Statements/i,
  /Financial Statements/i,
  /Results of Operations/i,
  /Liquidity and Capital/i,
];

const FORM_LABEL: Record<EdgarReportForm, { cn: string; en: string }> = {
  '10-K': { cn: '年报 (10-K)', en: 'Annual report (10-K)' },
  '10-Q': { cn: '季报 (10-Q)', en: 'Quarterly report (10-Q)' },
  '20-F': { cn: '年报 (20-F)', en: 'Annual report (20-F)' },
};

export const normalizeUSTicker = (ticker: string): string | null => {
  const raw = (ticker || '').trim().toUpperCase();
  const base = raw.replace(/\.(US|U)$/i, '').split('.')[0];
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(base) ? base : null;
};

export const isUSProfile = (
  profile: Pick<CompanyProfile, 'ticker' | 'exchange'>
): boolean => getEquityMarket(profile) === 'US';

export const buildEdgarPrefetchPlan = (): EdgarFetchSpec[] => [
  { form: '10-K' },
  { form: '10-Q' },
];

const splitMarkdownSections = (body: string): Array<{ title: string; content: string }> => {
  const lines = body.split(/\r?\n/);
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = 'Body';
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ title: currentTitle, content });
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^(Item\s+\d+[A-Z]?[^\n]*|Part [IVX]+,?\s*Item\s+\d+[^\n]*)$/i);
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
    chunks.push(`${block.slice(0, remaining)}\n… (excerpt truncated)`);
    break;
  }

  if (chunks.length === 0) {
    return `${normalized.slice(0, maxChars)}\n… (excerpt truncated)`;
  }
  return chunks.join('\n\n');
};

export const buildEdgarEvidenceText = (
  reports: EdgarReportPayload[],
  lang: Language,
  maxCharsPerReport: number
): string => {
  if (!reports.length) return '';

  const blocks = reports.map(report => {
    const formLabel = FORM_LABEL[report.form][lang === 'cn' ? 'cn' : 'en'];
    const header =
      lang === 'cn'
        ? `来源：SEC EDGAR | ${report.title} | 提交日期 ${report.filingDate} | ${formLabel}${report.fiscalPeriod ? ` | 报告期 ${report.fiscalPeriod}` : ''}`
        : `Source: SEC EDGAR | ${report.title} | filed ${report.filingDate} | ${formLabel}${report.fiscalPeriod ? ` | period ${report.fiscalPeriod}` : ''}`;
    const excerpt = extractFilingExcerpt(report.body, maxCharsPerReport);
    return `${header}\n${excerpt}`;
  });

  return blocks.join('\n\n' + '-'.repeat(40) + '\n\n');
};

export const buildEdgarEvidencePromptBlock = (
  evidenceText: string,
  lang: Language
): string => {
  if (!evidenceText.trim()) return '';

  if (lang === 'cn') {
    return `【SEC EDGAR 法定披露原文 — 美股财报数字以此为准】
以下摘录自美国 SEC EDGAR 系统已下载并解析的 10-K / 10-Q 等法定申报文件（含 XBRL 财务报表）。
规则：
1. 涉及营收、利润、现金流、资产负债、EPS、毛利率、费用率、分部数据等，必须优先引用以下原文；禁止用网页搜索中的二手媒体数字覆盖原文。
2. 若原文未覆盖某指标，可补充搜索，但须标注「原文未披露」或「来自其他来源」。
3. 引用须标注表格类型与提交/报告期（如 FY2025 10-K / Q2 2026 10-Q）。
4. 网页搜索仅用于补充近期新闻、政策、行业动态，不得与原文财务数字冲突；冲突时以 EDGAR 原文为准。

${evidenceText}`;
  }

  return `[SEC EDGAR OFFICIAL FILING EXCERPTS — primary source for US financial figures]
The following text is extracted from 10-K / 10-Q (and related) filings downloaded from the SEC EDGAR system, including XBRL financial statements.
Rules:
1. For revenue, profit, cash flow, balance sheet items, EPS, margins, segment data, etc., cite these excerpts FIRST — do NOT override with secondary web search figures.
2. If a metric is missing below, you may use search but must label it as "not in filing excerpt" or "from other source".
3. Always label form type and filing / fiscal period (e.g. FY2025 10-K / Q2 2026 10-Q).
4. Web search is for recent news/policy/industry context only; on numeric conflicts, EDGAR excerpts win.

${evidenceText}`;
};

export const buildEdgarFilingBundle = (params: {
  ticker: string;
  reports: EdgarReportPayload[];
  errors: EdgarFilingBundle['errors'];
  lang: Language;
  maxCharsPerReport?: number;
}): EdgarFilingBundle => {
  const maxCharsPerReport = params.maxCharsPerReport ?? readMaxCharsPerReport();
  const evidenceText = buildEdgarEvidenceText(params.reports, params.lang, maxCharsPerReport);
  return {
    ticker: params.ticker,
    reports: params.reports,
    errors: params.errors,
    evidenceText,
  };
};

export const readMaxCharsPerReport = (): number => {
  const raw = Number(process.env.EDGAR_MAX_CHARS_PER_REPORT || '6000');
  if (!Number.isFinite(raw) || raw <= 0) return 6000;
  return Math.min(Math.floor(raw), 20000);
};

export const readEdgarEnabled = (): boolean => {
  const flag = (process.env.EDGAR_ENABLED || 'true').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
};

export const readEdgarIdentity = (): string | null => {
  const raw = (process.env.EDGAR_IDENTITY || '').trim();
  return raw || null;
};
