import { readEdgarIdentity } from '../../utils/edgarFilingContext.js';
import { secFetchText } from './secRequestClient.js';

const MAX_DOCUMENT_CHARS = 1_500_000;
const MAX_ITEM4_CHARS = 12_000;

export interface StakeFilingParseInput {
  accessionNumber: string;
  documentUrl: string;
  formType: string;
  extractItem4?: boolean;
}

export interface StakeFilingParseResult {
  accessionNumber: string;
  ownershipPct?: number | null;
  sharesOwned?: number | null;
  item4Text?: string | null;
  parseStatus?: 'ok' | 'partial' | 'failed';
  error?: string;
}

const fetchSecDocument = async (url: string): Promise<string> => {
  const text = await secFetchText(url);
  return text.length > MAX_DOCUMENT_CHARS ? text.slice(0, MAX_DOCUMENT_CHARS) : text;
};

const stripHtml = (source: string): string =>
  source
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|td|th|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parsePercentValue = (raw: string): number | null => {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Number(value.toFixed(4));
};

const parseShareValue = (raw: string): number | null => {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

const extractCoverPageRowValues = (
  html: string,
  rowNumber: number,
  kind: 'percent' | 'shares'
): number[] => {
  const rowPattern = new RegExp(
    `tableClassValign(?:NoBorder)?">\\s*${rowNumber}\\s*<\\/td>[\\s\\S]*?<div class="text">\\s*([\\d,]+(?:\\.\\d+)?)\\s*(%?)`,
    'gi'
  );
  const values: number[] = [];
  for (const match of html.matchAll(rowPattern)) {
    const hasPercent = (match[2] ?? '').includes('%');
    if (kind === 'percent') {
      if (!hasPercent) continue;
      const value = parsePercentValue(match[1] ?? '');
      if (value != null) values.push(value);
    } else {
      if (hasPercent) continue;
      const value = parseShareValue(match[1] ?? '');
      if (value != null) values.push(value);
    }
  }
  return values;
};

const stakeCoverPageRows = (formType: string): { sharesRow: number; percentRow: number } => {
  if (formType.toUpperCase().includes('13G')) {
    return { sharesRow: 9, percentRow: 11 };
  }
  return { sharesRow: 11, percentRow: 13 };
};

const extractDocumentText = (source: string): string => {
  const textBlock = source.match(/<TEXT>([\s\S]*?)<\/TEXT>/i)?.[1];
  return (textBlock ?? source).trim();
};

const extractOwnershipFromPlainText = (source: string, formType: string): number | null => {
  const is13G = formType.toUpperCase().includes('13G');
  const percentRow = is13G ? 11 : 13;
  const text = extractDocumentText(source).replace(/\r/g, '');

  const rowPatterns = [
    new RegExp(
      `\\(${percentRow}\\)\\s*Percent of class[^\\n]*\\n\\s*([\\d,]+(?:\\.\\d+)?)\\s*%`,
      'i'
    ),
    new RegExp(`\\(${percentRow}\\)[\\s\\S]{0,160}?([\\d,]+(?:\\.\\d+)?)\\s*%`, 'i'),
    /Percent of class\s*\n\s*([\d,]+(?:\.\d+)?)\s*%/i,
  ];

  for (const pattern of rowPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parsePercentValue(match[1]);
      if (value != null) return value;
    }
  }

  return null;
};

const extractOwnershipFromLegacyHtml = (html: string, formType: string): number | null => {
  const is13G = formType.toUpperCase().includes('13G');
  const referencedRow = is13G ? 9 : 11;
  const coverRow = is13G ? 11 : 13;

  const labelPattern = new RegExp(
    `PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW \\(${referencedRow}\\)[\\s\\S]{0,500}?([\\d,]+(?:\\.\\d+)?)\\s*%`,
    'i'
  );
  const labelMatch = html.match(labelPattern);
  if (labelMatch?.[1]) {
    const value = parsePercentValue(labelMatch[1]);
    if (value != null) return value;
  }

  const rowPattern = new RegExp(
    `<TD[^>]*>\\s*${coverRow}\\.\\s*<\\/TD>[\\s\\S]{0,900}?([\\d,]+(?:\\.\\d+)?)\\s*%`,
    'i'
  );
  const rowMatch = html.match(rowPattern);
  if (rowMatch?.[1]) {
    const value = parsePercentValue(rowMatch[1]);
    if (value != null) return value;
  }

  return null;
};

const extractSharesFromPlainText = (source: string, formType: string): number | null => {
  const is13G = formType.toUpperCase().includes('13G');
  const sharesRow = is13G ? 9 : 11;
  const text = extractDocumentText(source).replace(/\r/g, '');
  const match = text.match(
    new RegExp(
      `\\(${sharesRow}\\)\\s*Aggregate amount[\\s\\S]{0,120}?\\n\\s*([\\d,]+)\\s*(?:\\n|$)`,
      'i'
    )
  );
  if (match?.[1]) return parseShareValue(match[1]);
  return null;
};

/** SEC cover-page percent-of-class row (13D row 13, 13G row 11). */
export const extractCoverPageOwnershipPct = (html: string, formType = 'SC 13D'): number | null => {
  const { percentRow } = stakeCoverPageRows(formType);
  const values = extractCoverPageRowValues(html, percentRow, 'percent');
  if (values.length === 0) {
    const text = stripHtml(html);
    const fallbackPatterns = [
      /percent of class represented by amount in row \(\d+\)[^0-9]{0,40}([\d,]+(?:\.\d+)?)\s*%/gi,
      /(?:percentage|percent) of (?:the )?(?:class|outstanding)[^0-9]{0,80}([\d,]+(?:\.\d+)?)\s*%/gi,
    ];
    for (const pattern of fallbackPatterns) {
      for (const match of text.matchAll(pattern)) {
        const value = parsePercentValue(match[1] ?? '');
        if (value != null) values.push(value);
      }
    }
  }
  if (values.length === 0) {
    const legacy = extractOwnershipFromLegacyHtml(html, formType);
    if (legacy != null) return legacy;
    return extractOwnershipFromPlainText(html, formType);
  }
  const overFive = values.filter(value => value >= 5);
  return overFive.length > 0 ? Math.max(...overFive) : Math.max(...values);
};

/** SEC cover-page aggregate shares row (13D row 11, 13G row 9). */
export const extractCoverPageSharesOwned = (html: string, formType = 'SC 13D'): number | null => {
  const { sharesRow } = stakeCoverPageRows(formType);
  const values = extractCoverPageRowValues(html, sharesRow, 'shares');
  if (values.length > 0) return Math.max(...values);
  return extractSharesFromPlainText(html, formType);
};

const extractItemSectionFromText = (text: string, itemNumber: number): string | null => {
  const upper = text.toUpperCase();
  const startMatch = upper.match(new RegExp(`\\bITEM\\s+${itemNumber}\\b`));
  if (!startMatch || startMatch.index == null) return null;
  const start = startMatch.index;
  const endMatch = upper.slice(start + 8).match(new RegExp(`\\bITEM\\s+${itemNumber + 1}\\b|\\bSIGNATURES?\\b`));
  const end = endMatch?.index != null ? start + 8 + endMatch.index : text.length;
  const chunk = text.slice(start, end).trim();
  return chunk ? chunk.slice(0, MAX_ITEM4_CHARS) : null;
};

/** Item 4 purpose text from SEC HTML table layout or plain-text sections. */
export const extractItem4Text = (html: string, formType: string): string | null => {
  if (!formType.toUpperCase().includes('13D')) return null;

  const item4TablePattern =
    /Item\s+4\.[\s\S]*?Purpose of Transaction[\s\S]*?<div class="largetext"[^>]*>([\s\S]*?)<\/div>/i;
  const tableMatch = html.match(item4TablePattern);
  if (tableMatch?.[1]) {
    return stripHtml(tableMatch[1]).slice(0, MAX_ITEM4_CHARS);
  }

  const text = stripHtml(html);
  const item4FromText = extractItemSectionFromText(text, 4);
  if (item4FromText && item4FromText.length > 40) {
    return item4FromText.slice(0, MAX_ITEM4_CHARS);
  }

  // Many 13D/A amendments omit Item 4 — use Item 1 comment or Item 5(c) activity as fallback context.
  const item1CommentPattern =
    /Item\s+1\s+Comment:[\s\S]*?<div class="largetext"[^>]*>([\s\S]*?)<\/div>/i;
  const item1Match = html.match(item1CommentPattern);
  if (item1Match?.[1]) {
    const comment = stripHtml(item1Match[1]);
    if (comment.length > 40) {
      return `[Item 1 comment] ${comment}`.slice(0, MAX_ITEM4_CHARS);
    }
  }

  const item5cPattern =
    /Item\s+5\.[\s\S]*?\(c\)[\s\S]*?<div class="largetext"[^>]*>([\s\S]*?)<\/div>/i;
  const item5cMatch = html.match(item5cPattern);
  if (item5cMatch?.[1]) {
    const activity = stripHtml(item5cMatch[1]);
    if (activity.length > 40) {
      return `[Item 5(c) transactions] ${activity}`.slice(0, MAX_ITEM4_CHARS);
    }
  }

  return null;
};

export const parseStakeFilingDocument = async (
  input: StakeFilingParseInput
): Promise<StakeFilingParseResult> => {
  const identity = readEdgarIdentity();
  if (!identity) {
    return {
      accessionNumber: input.accessionNumber,
      parseStatus: 'failed',
      error: 'EDGAR_IDENTITY is not configured',
    };
  }

  try {
    const html = await fetchSecDocument(input.documentUrl);
    const ownershipPct = extractCoverPageOwnershipPct(html, input.formType);
    const sharesOwned = extractCoverPageSharesOwned(html, input.formType);
    const item4Text = input.extractItem4 ? extractItem4Text(html, input.formType) : null;

    let parseStatus: 'ok' | 'partial' | 'failed' = 'failed';
    if (ownershipPct != null) parseStatus = 'ok';
    else if (item4Text) parseStatus = 'partial';

    return {
      accessionNumber: input.accessionNumber,
      ownershipPct,
      sharesOwned,
      item4Text,
      parseStatus,
    };
  } catch (error) {
    return {
      accessionNumber: input.accessionNumber,
      parseStatus: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const parseStakeFilings = async (
  filings: StakeFilingParseInput[]
): Promise<StakeFilingParseResult[]> => {
  const results: StakeFilingParseResult[] = [];
  for (const filing of filings) {
    results.push(await parseStakeFilingDocument(filing));
  }
  return results;
};
