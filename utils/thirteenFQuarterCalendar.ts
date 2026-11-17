import type { ThirteenFQuarterId, ThirteenFQuarterOption } from '../types/thirteenF.ts';

/** Compare calendar quarters (e.g. 2026-Q3 > 2026-Q2). */
export const compareThirteenFQuarters = (a: string, b: string): number => {
  const parse = (quarter: string): [number, number] => {
    const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
    if (!match) return [0, 0];
    return [Number(match[1]), Number(match[2])];
  };
  const [ay, aq] = parse(a);
  const [by, bq] = parse(b);
  if (ay !== by) return ay - by;
  return aq - bq;
};

const quarterReportPeriodEndUtc = (year: number, quarter: 1 | 2 | 3 | 4): Date => {
  switch (quarter) {
    case 1:
      return new Date(Date.UTC(year, 2, 31));
    case 2:
      return new Date(Date.UTC(year, 5, 30));
    case 3:
      return new Date(Date.UTC(year, 8, 30));
    case 4:
      return new Date(Date.UTC(year, 11, 31));
    default:
      return new Date(Date.UTC(year, 0, 1));
  }
};

/** SEC 13F-HR is generally due 45 calendar days after the report period ends. */
const thirteenFFilingDeadlineUtc = (year: number, quarter: 1 | 2 | 3 | 4): Date => {
  const end = quarterReportPeriodEndUtc(year, quarter);
  const deadline = new Date(end);
  deadline.setUTCDate(deadline.getUTCDate() + 45);
  return deadline;
};

const parseQuarterId = (quarter: ThirteenFQuarterId): { year: number; q: 1 | 2 | 3 | 4 } | null => {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) return null;
  return { year: Number(match[1]), q: Number(match[2]) as 1 | 2 | 3 | 4 };
};

/** Newest report quarter whose filing deadline has passed as of `asOf` (UTC). */
export const inferExpectedLatest13FQuarter = (
  asOf: Date = new Date()
): ThirteenFQuarterId => {
  const asOfUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const startYear = asOf.getUTCFullYear() + 1;

  const candidates: ThirteenFQuarterId[] = [];
  for (let year = startYear; year >= startYear - 3; year -= 1) {
    for (let q = 4; q >= 1; q -= 1) {
      candidates.push(`${year}-Q${q}` as ThirteenFQuarterId);
    }
  }

  for (const quarter of candidates) {
    const parsed = parseQuarterId(quarter);
    if (!parsed) continue;
    const deadline = thirteenFFilingDeadlineUtc(parsed.year, parsed.q).getTime();
    if (asOfUtc >= deadline) {
      return quarter;
    }
  }

  return '2024-Q4';
};

export const priorThirteenFQuarter = (quarter: ThirteenFQuarterId): ThirteenFQuarterId => {
  const parsed = parseQuarterId(quarter);
  if (!parsed) return '2025-Q1';
  if (parsed.q === 1) return `${parsed.year - 1}-Q4` as ThirteenFQuarterId;
  return `${parsed.year}-Q${parsed.q - 1}` as ThirteenFQuarterId;
};

const approximateFilingDate = (year: number, quarter: 1 | 2 | 3 | 4): string => {
  const deadline = thirteenFFilingDeadlineUtc(year, quarter);
  return deadline.toISOString().slice(0, 10);
};

const reportDateForQuarter = (year: number, quarter: 1 | 2 | 3 | 4): string =>
  quarterReportPeriodEndUtc(year, quarter).toISOString().slice(0, 10);

/** Rolling mock / fallback quarter list aligned with the current 13F filing calendar. */
export const buildRollingQuarterCalendar = (
  asOf: Date = new Date(),
  count = 8
): ThirteenFQuarterOption[] => {
  const latest = inferExpectedLatest13FQuarter(asOf);
  const options: ThirteenFQuarterOption[] = [];
  let current: ThirteenFQuarterId = latest;

  for (let index = 0; index < count; index += 1) {
    const parsed = parseQuarterId(current);
    if (!parsed) break;
    options.push({
      quarter: current,
      filingDate: approximateFilingDate(parsed.year, parsed.q),
      reportDate: reportDateForQuarter(parsed.year, parsed.q),
      isLatest: index === 0,
    });
    current = priorThirteenFQuarter(current);
  }

  return options;
};