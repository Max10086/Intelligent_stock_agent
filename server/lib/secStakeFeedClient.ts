import type {
  ThirteenFStakeFeedResponse,
  ThirteenFStakeFiling,
  ThirteenFStakeMajorEvent,
} from '../../types/thirteenF.js';
import { readEdgarIdentity } from '../../utils/edgarFilingContext.js';
import { normalizeInstitutionCik, resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { fetchSecCompanyProfile } from './secSubmissionsClient.js';
import { secFetchJson } from './secRequestClient.js';

const INSTITUTION_CONCURRENCY = 1;
const TARGET_ENRICH_CONCURRENCY = 2;
const INITIAL_FORMS = new Set(['SC 13D', 'SC 13G']);
const AMENDMENT_FORMS = new Set(['SC 13D/A', 'SC 13G/A']);

const FORM_TYPE_ALIASES: Record<string, string> = {
  'SC 13D': 'SC 13D',
  'SC 13D/A': 'SC 13D/A',
  'SC 13G': 'SC 13G',
  'SC 13G/A': 'SC 13G/A',
  'SCHEDULE 13D': 'SC 13D',
  'SCHEDULE 13D/A': 'SC 13D/A',
  'SCHEDULE 13G': 'SC 13G',
  'SCHEDULE 13G/A': 'SC 13G/A',
  '13D': 'SC 13D',
  '13D/A': 'SC 13D/A',
  '13G': 'SC 13G',
  '13G/A': 'SC 13G/A',
};

type SecSubmissionsRecent = {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  fileNumber?: string[];
};

type SecSubmissionsPayload = {
  name?: string;
  filings?: {
    recent?: SecSubmissionsRecent;
  };
};

type RawStakeRow = {
  cik: string;
  institutionName: string;
  normalizedForm: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  fileNumber: string | null;
};

export const normalizeStakeFormType = (formType: string): string | null => {
  const cleaned = formType.trim().toUpperCase();
  if (!cleaned) return null;
  if (FORM_TYPE_ALIASES[cleaned]) return FORM_TYPE_ALIASES[cleaned];
  if (cleaned.startsWith('SCHEDULE 13')) {
    return FORM_TYPE_ALIASES[cleaned] ?? FORM_TYPE_ALIASES[cleaned.replace('SCHEDULE ', 'SC ')] ?? null;
  }
  return null;
};

export const classifyStakeMajorEvent = (formType: string): ThirteenFStakeMajorEvent => {
  if (INITIAL_FORMS.has(formType)) return 'NEW_5PCT_STAKE';
  if (AMENDMENT_FORMS.has(formType)) return 'POSITION_CHANGE';
  return 'OTHER';
};

const edgarBrowseUrl = (accession: string): string => {
  const compact = accession.replace(/-/g, '');
  return `https://www.sec.gov/cgi-bin/viewer?action=view&accession_number=${compact}&xbrl_type=v`;
};

const filingDocumentUrl = (
  accession: string,
  primaryDocument: string,
  subjectCik: string | null
): string => {
  if (!subjectCik || !primaryDocument) return edgarBrowseUrl(accession);
  const subjectDigits = subjectCik.replace(/\D/g, '').replace(/^0+/, '') || '0';
  const accessionCompact = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${subjectDigits}/${accessionCompact}/${primaryDocument}`;
};

const stripCikSuffix = (name: string): string =>
  name.replace(/\s*\(CIK[^)]+\)\s*/gi, '').trim();

const parseTargetFromEfts = async (
  accession: string,
  filerCik: string
): Promise<{ targetCompanyName: string | null; targetCompanyCik: string | null }> => {
  const compact = accession.replace(/-/g, '');
  const queries = [`accession_number:"${accession}"`, `"${compact}"`, `"${accession}"`];

  for (const query of queries) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}`;
    try {
      const payload = await secFetchJson<{
        hits?: { hits?: Array<{ _source?: { display_names?: string[]; ciks?: string[] } }> };
      }>(url);
      const source = payload.hits?.hits?.[0]?._source;
      const displayNames = source?.display_names ?? [];
      const ciks = source?.ciks ?? [];
      if (displayNames.length === 0) continue;

      const filerNormalized = normalizeInstitutionCik(filerCik);
      for (let index = 0; index < displayNames.length; index += 1) {
        const cik = ciks[index] ? normalizeInstitutionCik(ciks[index]) : null;
        if (cik && cik === filerNormalized) continue;
        const targetCompanyName = stripCikSuffix(displayNames[index] ?? '') || null;
        if (targetCompanyName) {
          return { targetCompanyName, targetCompanyCik: cik };
        }
      }
    } catch {
      // try next query shape
    }
  }

  return { targetCompanyName: null, targetCompanyCik: null };
};

const fetchRawRowsForCik = async (
  cikInput: string,
  sinceDate: string | null,
  limitPerInstitution: number
): Promise<{ rows: RawStakeRow[]; totalInWindow: number }> => {
  const cik = resolveInstitutionCik(cikInput);

  const payload = await secFetchJson<SecSubmissionsPayload>(
    `https://data.sec.gov/submissions/CIK${cik}.json`
  );

  const institutionName = payload.name?.trim() || cik;
  const recent = payload.filings?.recent ?? {};
  const forms = recent.form ?? [];
  const filingDates = recent.filingDate ?? [];
  const accessionNumbers = recent.accessionNumber ?? [];
  const primaryDocuments = recent.primaryDocument ?? [];
  const fileNumbers = recent.fileNumber ?? [];

  const rows: RawStakeRow[] = [];
  let totalInWindow = 0;

  // SEC `recent` is reverse-chronological. Walk until we leave the lookback window,
  // collecting every stake form inside the window (cap only applies after filtering).
  for (let index = 0; index < forms.length; index += 1) {
    const filingDate = filingDates[index] ?? '';
    if (sinceDate && filingDate && filingDate < sinceDate) break;

    const normalizedForm = normalizeStakeFormType(forms[index] ?? '');
    if (!normalizedForm) continue;

    const accessionNumber = accessionNumbers[index] ?? '';
    if (!accessionNumber || !filingDate) continue;

    totalInWindow += 1;
    if (rows.length >= limitPerInstitution) continue;

    rows.push({
      cik,
      institutionName,
      normalizedForm,
      filingDate,
      accessionNumber,
      primaryDocument: primaryDocuments[index] ?? '',
      fileNumber: fileNumbers[index] ?? null,
    });
  }

  return { rows, totalInWindow };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]!, current);
    }
  });

  await Promise.all(workers);
  return results;
};

const enrichRawRows = async (rows: RawStakeRow[]): Promise<ThirteenFStakeFiling[]> => {
  const targetCache = new Map<string, { targetCompanyName: string | null; targetCompanyCik: string | null }>();
  const tickerCache = new Map<string, string | null>();

  const resolveTargetTicker = async (targetCompanyCik: string | null): Promise<string | null> => {
    if (!targetCompanyCik) return null;
    const normalized = normalizeInstitutionCik(targetCompanyCik);
    if (tickerCache.has(normalized)) {
      return tickerCache.get(normalized) ?? null;
    }
    const profile = await fetchSecCompanyProfile(normalized);
    const ticker = profile?.ticker ?? null;
    tickerCache.set(normalized, ticker);
    return ticker;
  };

  return mapWithConcurrency(rows, TARGET_ENRICH_CONCURRENCY, async row => {
    let targetCompanyName: string | null = null;
    let targetCompanyCik: string | null = null;

    const cached = targetCache.get(row.accessionNumber);
    if (cached) {
      targetCompanyName = cached.targetCompanyName;
      targetCompanyCik = cached.targetCompanyCik;
    } else {
      const target = await parseTargetFromEfts(row.accessionNumber, row.cik);
      targetCache.set(row.accessionNumber, target);
      targetCompanyName = target.targetCompanyName;
      targetCompanyCik = target.targetCompanyCik;
    }

    const targetCompanyTicker = await resolveTargetTicker(targetCompanyCik);

    const documentCik = targetCompanyCik ?? row.cik;
    return {
      id: `${row.cik}-${row.accessionNumber}`,
      filerCik: row.cik,
      filerName: row.institutionName,
      formType: row.normalizedForm,
      filingDate: row.filingDate,
      accessionNumber: row.accessionNumber,
      fileNumber: row.fileNumber,
      targetCompanyName,
      targetCompanyCik,
      targetCompanyTicker,
      documentUrl: filingDocumentUrl(row.accessionNumber, row.primaryDocument, documentCik),
      isMajorEvent: classifyStakeMajorEvent(row.normalizedForm),
    };
  });
};

export const fetchStakeFeedFromSec = async (params: {
  ciks: string[];
  limit?: number;
  limitPerInstitution?: number;
  sinceDate?: string | null;
  lookbackDays?: number | null;
}): Promise<ThirteenFStakeFeedResponse & { errors?: string[] }> => {
  const identity = readEdgarIdentity();
  if (!identity) {
    throw new Error('EDGAR_IDENTITY is not configured');
  }

  const uniqueCiks = [...new Set(params.ciks.map(cik => resolveInstitutionCik(cik)).filter(Boolean))];
  const limit = Math.max(1, Math.min(params.limit ?? 100, 300));
  const limitPerInstitution = Math.max(1, Math.min(params.limitPerInstitution ?? 20, 150));
  const sinceDate = params.sinceDate ?? null;

  if (uniqueCiks.length === 0) {
    return {
      filings: [],
      totalCount: 0,
      institutionCount: 0,
      fetchedAt: new Date().toISOString(),
      dataSource: 'sec-edgar-submissions',
      sinceDate,
      lookbackDays: params.lookbackDays ?? null,
    };
  }

  const errors: string[] = [];
  const rawRows: RawStakeRow[] = [];
  let totalMatching = 0;

  await mapWithConcurrency(uniqueCiks, INSTITUTION_CONCURRENCY, async cik => {
    try {
      const { rows, totalInWindow } = await fetchRawRowsForCik(
        cik,
        sinceDate,
        limitPerInstitution
      );
      totalMatching += totalInWindow;
      rawRows.push(...rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${cik}: ${message}`);
      console.warn(`[13f-stake] failed for ${cik}:`, message);
    }
  });

  rawRows.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const trimmedRaw = rawRows.slice(0, limit);
  const filings = await enrichRawRows(trimmedRaw);

  if (filings.length === 0 && errors.length > 0 && errors.length === uniqueCiks.length) {
    throw new Error(errors.join('; '));
  }

  return {
    filings,
    totalCount: totalMatching,
    institutionCount: uniqueCiks.length,
    fetchedAt: new Date().toISOString(),
    dataSource: 'sec-edgar-submissions',
    sinceDate,
    lookbackDays: params.lookbackDays ?? null,
    errors: errors.length > 0 ? errors : undefined,
  };
};
