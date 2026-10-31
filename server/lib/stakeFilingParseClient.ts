import type { StakeFilingParseInput, StakeFilingParseResult } from './stakeFilingParser.js';
import { parseStakeFilings } from './stakeFilingParser.js';

export type { StakeFilingParseInput, StakeFilingParseResult };

const PARSE_CONCURRENCY = 3;

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]!);
    }
  });

  await Promise.all(workers);
  return results;
};

/** Historical name kept for callers — uses Node fetch + TS parser (not Python). */
export const parseStakeFilingsViaPython = async (
  filings: StakeFilingParseInput[]
): Promise<StakeFilingParseResult[]> => {
  if (filings.length === 0) return [];
  return mapWithConcurrency(filings, PARSE_CONCURRENCY, async filing => {
    const [result] = await parseStakeFilings([filing]);
    return result!;
  });
};
