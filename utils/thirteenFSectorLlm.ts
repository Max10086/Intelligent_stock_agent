import { tryParseModelJson } from './modelJson.js';

export const GICS_SECTOR_NAMES = [
  'Energy',
  'Materials',
  'Industrials',
  'Consumer Discretionary',
  'Consumer Staples',
  'Health Care',
  'Financials',
  'Information Technology',
  'Communication Services',
  'Utilities',
  'Real Estate',
] as const;

export type GicsSectorName = (typeof GICS_SECTOR_NAMES)[number];

const GICS_SECTOR_SET = new Set<string>(GICS_SECTOR_NAMES);

export interface SectorLookupRequest {
  ticker: string;
  name: string;
}

export interface SectorLookupResult {
  ticker: string;
  sector: string;
  industry?: string;
}

export const buildSectorLookupPrompt = (items: SectorLookupRequest[]): string => {
  const lines = items.map(row => `- ${row.ticker}: ${row.name}`);
  return `Classify each US-listed company into exactly one GICS sector using the same English sector names as S&P 500 and Russell 2000 indices.

Valid sectors (use exactly one of these strings):
${GICS_SECTOR_NAMES.map(name => `- ${name}`).join('\n')}

Companies:
${lines.join('\n')}

Return JSON only:
{
  "items": [
    { "ticker": "AAPL", "sector": "Information Technology", "industry": "Consumer Electronics" }
  ]
}

Rules:
- sector must be one of the valid sectors above (English, exact spelling)
- industry is optional — short English sub-industry name if known
- one entry per input ticker`;
};

export const parseSectorLookupResponse = (
  raw: string,
  requestedTickers: string[]
): SectorLookupResult[] => {
  const parsed = tryParseModelJson(raw) as { items?: unknown };
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const requested = new Set(requestedTickers.map(t => t.toUpperCase()));
  const results: SectorLookupResult[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ticker = String(row.ticker ?? '')
      .trim()
      .toUpperCase()
      .replace(/\./g, '-');
    const sector = String(row.sector ?? '').trim();
    const industry = row.industry != null ? String(row.industry).trim() : undefined;
    if (!ticker || !requested.has(ticker) || !GICS_SECTOR_SET.has(sector)) continue;
    results.push({
      ticker,
      sector,
      industry: industry || undefined,
    });
  }

  return results;
};

export const isValidGicsSector = (sector: string): sector is GicsSectorName =>
  GICS_SECTOR_SET.has(sector);
