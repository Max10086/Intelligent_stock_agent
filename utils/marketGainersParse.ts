import { extractJsonObjectText, repairJsonText, tryParseModelJson } from './modelJson.ts';
import type { ParsedGainerEntry, ParsedGainerPayload } from '../types/marketGainers.ts';

const looksLikePlaceholderEntry = (entry: ParsedGainerEntry): boolean => {
  if (/^公司[A-Z]$/.test(entry.name)) return true;
  if (/^Company [A-Z]$/i.test(entry.name)) return true;
  if (/^公司[A-Z]/.test(entry.name)) return true;
  if (/^测试|^示例|^样本/.test(entry.name)) return true;
  return false;
};

const normalizeEntry = (raw: unknown, index: number): ParsedGainerEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const ticker = String(row.ticker || row.symbol || '').trim().toUpperCase();
  const name = String(row.name || row.company || ticker).trim();
  const blurb = String(row.blurb || row.summary || row.description || '').trim();
  const rank = Number(row.rank ?? index + 1);
  const changePct = Number(row.changePct ?? row.change_pct ?? row.gain ?? row.pct);
  const exchange = row.exchange ? String(row.exchange).trim() : undefined;

  if (!ticker || !name || !Number.isFinite(changePct)) return null;

  const entry = {
    rank: Number.isFinite(rank) ? Math.max(1, Math.round(rank)) : index + 1,
    name,
    ticker,
    exchange,
    changePct,
    blurb: blurb || name,
  };

  if (looksLikePlaceholderEntry(entry)) return null;
  return entry;
};

export const parseMarketGainersResponse = (rawText: string): ParsedGainerPayload => {
  const jsonText = extractJsonObjectText(rawText);
  if (!jsonText) {
    throw new Error('Gainer response did not contain JSON');
  }

  const parsed = tryParseModelJson(repairJsonText(jsonText));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gainer JSON could not be parsed');
  }

  const payload = parsed as Record<string, unknown>;
  const entriesRaw = Array.isArray(payload.entries)
    ? payload.entries
    : Array.isArray(payload.items)
      ? payload.items
      : [];

  const entries = entriesRaw
    .map((entry, index) => normalizeEntry(entry, index))
    .filter(Boolean) as ParsedGainerEntry[];

  if (entries.length === 0) {
    throw new Error('Gainer JSON contained no valid entries (possible placeholder/hallucinated data)');
  }

  entries.sort((a, b) => a.rank - b.rank);

  return {
    asOfDate: String(payload.asOfDate || payload.as_of_date || '').trim(),
    periodStart: payload.periodStart
      ? String(payload.periodStart).trim()
      : payload.period_start
        ? String(payload.period_start).trim()
        : undefined,
    entries: entries.slice(0, 20),
  };
};

export const parseGainerBlurbsResponse = (
  rawText: string
): Map<string, string> => {
  const jsonText = extractJsonObjectText(rawText);
  if (!jsonText) {
    throw new Error('Blurb response did not contain JSON');
  }

  const parsed = tryParseModelJson(repairJsonText(jsonText));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Blurb JSON could not be parsed');
  }

  const payload = parsed as Record<string, unknown>;
  const blurbsRaw = Array.isArray(payload.blurbs) ? payload.blurbs : [];
  const result = new Map<string, string>();

  for (const row of blurbsRaw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const ticker = String(item.ticker || '').trim().toUpperCase();
    const blurb = String(item.blurb || '').trim();
    if (ticker && blurb) {
      result.set(ticker, blurb.slice(0, 40));
    }
  }

  if (result.size === 0) {
    throw new Error('Blurb JSON contained no valid entries');
  }

  return result;
};

export const resolveGainerBadge = (params: {
  appearanceScore: number;
  dailyAppearances14d: number;
}): 'none' | 'recurring' | 'hot' | 'trending' => {
  const { appearanceScore, dailyAppearances14d } = params;
  if (appearanceScore >= 5 || dailyAppearances14d >= 3) return 'trending';
  if (appearanceScore >= 3 || dailyAppearances14d >= 3) return 'hot';
  if (dailyAppearances14d >= 2 || appearanceScore >= 2) return 'recurring';
  return 'none';
};
