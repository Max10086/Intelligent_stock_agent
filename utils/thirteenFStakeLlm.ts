import { tryParseModelJson } from './modelJson.js';

export const STAKE_ITEM4_THEMES = [
  'BUY_MORE',
  'OPEN_LETTER',
  'PROXY_FIGHT',
  'STRATEGIC_REVIEW',
  'PASSIVE_DISCLOSURE',
  'OTHER',
] as const;

export type StakeItem4Theme = (typeof STAKE_ITEM4_THEMES)[number];

export interface StakeItem4SummaryRequest {
  accessionNumber: string;
  filerName: string;
  targetCompanyName?: string | null;
  filingDate?: string;
  item4Text: string;
}

export interface StakeItem4SummaryResult {
  accessionNumber: string;
  label: string;
  summary: string;
  theme: StakeItem4Theme;
}

export const buildStakeItem4Prompt = (input: StakeItem4SummaryRequest): string => {
  const target = input.targetCompanyName?.trim() || 'the issuer';
  const filed = input.filingDate?.trim() || 'unknown date';
  const text = input.item4Text.slice(0, 8000);

  return `You are analyzing Schedule 13D Item 4 ("Purpose of Transaction") for an investment research dashboard.

Filer: ${input.filerName}
Target: ${target}
Filed: ${filed}

Item 4 text:
"""
${text}
"""

Return JSON only:
{
  "label": "不超过8个汉字的简短目的标签",
  "summary": "1-3句简体中文，说明申报方对该标的的交易目的与意图",
  "theme": "BUY_MORE"
}

Valid theme values:
- BUY_MORE — accumulating shares / intends to buy more
- OPEN_LETTER — public letter, investor presentation, or outreach to management/shareholders
- PROXY_FIGHT — board seats, proxy contest, or activist campaign
- STRATEGIC_REVIEW — merger, sale, recap, or strategic alternatives
- PASSIVE_DISCLOSURE — routine disclosure without activist intent
- OTHER — none of the above

Rules:
- label and summary must both be in Simplified Chinese (简体中文), even if Item 4 is English
- label must be at most 8 Chinese characters; no punctuation unless essential
- summary must be factual; do not invent facts not supported by the text
- If the text is boilerplate only, use theme PASSIVE_DISCLOSURE and label like "常规披露"
- summary must be <= 280 characters`;
};

export const parseStakeItem4Response = (
  raw: string,
  accessionNumber: string
): StakeItem4SummaryResult | null => {
  const parsed = tryParseModelJson(raw) as {
    label?: unknown;
    summary?: unknown;
    theme?: unknown;
  };
  const summary = String(parsed?.summary ?? '').trim();
  const labelRaw = String(parsed?.label ?? '').trim();
  const themeRaw = String(parsed?.theme ?? '').trim().toUpperCase();
  const theme = STAKE_ITEM4_THEMES.includes(themeRaw as StakeItem4Theme)
    ? (themeRaw as StakeItem4Theme)
    : 'OTHER';
  if (!summary) return null;
  const label = (labelRaw || summary).slice(0, 8);
  return {
    accessionNumber,
    label,
    summary: summary.slice(0, 320),
    theme,
  };
};
