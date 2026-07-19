import type { ParsedGainerEntry } from '../types/marketGainers.ts';

export const buildUsGainerBlurbPrompt = (params: {
  tradingDateEnd: string;
  entries: ParsedGainerEntry[];
}): string => {
  const rows = params.entries.map(entry => ({
    ticker: entry.ticker,
    name: entry.name,
    changePct: entry.changePct,
  }));

  return [
    `Write concise Simplified Chinese blurbs for US stock daily gainers on ${params.tradingDateEnd}.`,
    'Each blurb explains the likely reason for the rise in one short phrase.',
    'Do NOT change tickers, ranks, or percentages — blurbs only.',
    'Return strict JSON only:',
    '{"blurbs":[{"ticker":"AAPL","blurb":"业绩超预期推动上涨。"}]}',
    `Requirements: one blurb per ticker below, max 40 Chinese characters each, Simplified Chinese only.`,
    `Tickers:\n${JSON.stringify(rows)}`,
  ].join('\n');
};
