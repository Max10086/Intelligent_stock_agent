import { readEdgarIdentity } from '../../utils/edgarFilingContext.js';
import { normalizeInstitutionCik, resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { normalizeStakeFormType } from '../lib/secStakeFeedClient.js';
import { secFetchJson } from '../lib/secRequestClient.js';
import { parseStakeFilingDocument } from '../lib/stakeFilingParser.js';
import {
  findPriorStakeOwnership,
  upsertStakeFilingCache,
  type StakeFilingCacheRecord,
} from './thirteenFStakeCacheService.js';

const SUBMISSIONS_TTL_MS = 10 * 60 * 1000;
const MAX_PRIOR_SCAN = 80;

type SecSubmissionsRecent = {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
};

type SecSubmissionsPayload = {
  name?: string;
  filings?: { recent?: SecSubmissionsRecent };
};

type SubmissionsCacheEntry = {
  expiresAt: number;
  recent: SecSubmissionsRecent;
  institutionName: string;
};

export type SecPriorFilingMatch = {
  accessionNumber: string;
  filingDate: string;
  formType: string;
  documentUrl: string;
  ownershipPct: number;
  sharesOwned: number | null;
};

const submissionsCache = new Map<string, SubmissionsCacheEntry>();
const priorLookupCache = new Map<string, SecPriorFilingMatch | null>();

const buildStakeDocumentUrl = (
  accession: string,
  primaryDocument: string,
  targetCompanyCik: string
): string => {
  const subjectDigits = targetCompanyCik.replace(/\D/g, '').replace(/^0+/, '') || '0';
  const accessionCompact = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${subjectDigits}/${accessionCompact}/${primaryDocument}`;
};

const priorLookupKey = (params: {
  filerCik: string;
  targetCompanyCik: string;
  filingDate: string;
  excludeAccession: string;
}): string =>
  `${params.filerCik}::${params.targetCompanyCik}::${params.filingDate}::${params.excludeAccession}`;

const loadFilerSubmissions = async (filerCikInput: string): Promise<SubmissionsCacheEntry> => {
  const filerCik = resolveInstitutionCik(filerCikInput);
  const hit = submissionsCache.get(filerCik);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const identity = readEdgarIdentity();
  if (!identity) throw new Error('EDGAR_IDENTITY is not configured');

  const payload = await secFetchJson<SecSubmissionsPayload>(
    `https://data.sec.gov/submissions/CIK${filerCik}.json`
  );
  const entry: SubmissionsCacheEntry = {
    expiresAt: Date.now() + SUBMISSIONS_TTL_MS,
    recent: payload.filings?.recent ?? {},
    institutionName: payload.name?.trim() || filerCik,
  };
  submissionsCache.set(filerCik, entry);
  return entry;
};

/** Find the most recent prior stake filing for the same issuer on SEC (one filing, cached). */
export const findPriorStakeFilingOnSec = async (params: {
  filerCik: string;
  filerName?: string;
  targetCompanyCik: string;
  targetCompanyName?: string | null;
  filingDate: string;
  excludeAccession: string;
}): Promise<SecPriorFilingMatch | null> => {
  const filerCik = resolveInstitutionCik(params.filerCik);
  const targetCompanyCik = normalizeInstitutionCik(params.targetCompanyCik);
  const cacheKey = priorLookupKey({
    filerCik,
    targetCompanyCik,
    filingDate: params.filingDate,
    excludeAccession: params.excludeAccession,
  });
  if (priorLookupCache.has(cacheKey)) {
    return priorLookupCache.get(cacheKey) ?? null;
  }

  const dbPrior = await findPriorStakeOwnership({
    filerCik,
    targetCompanyCik,
    targetCompanyName: params.targetCompanyName,
    filingDate: params.filingDate,
    excludeAccession: params.excludeAccession,
  });
  if (dbPrior) {
    const match: SecPriorFilingMatch = {
      accessionNumber: dbPrior.priorAccessionNumber,
      filingDate: dbPrior.priorFilingDate,
      formType: dbPrior.priorFormType ?? 'SC 13D/A',
      documentUrl: dbPrior.priorDocumentUrl ?? '',
      ownershipPct: dbPrior.priorOwnershipPct,
      sharesOwned: dbPrior.priorSharesOwned ?? null,
    };
    priorLookupCache.set(cacheKey, match);
    return match;
  }

  const { recent, institutionName } = await loadFilerSubmissions(filerCik);
  const forms = recent.form ?? [];
  const filingDates = recent.filingDate ?? [];
  const accessionNumbers = recent.accessionNumber ?? [];
  const primaryDocuments = recent.primaryDocument ?? [];

  const candidates: Array<{
    accessionNumber: string;
    filingDate: string;
    formType: string;
    primaryDocument: string;
  }> = [];

  for (let index = 0; index < forms.length; index += 1) {
    const formType = normalizeStakeFormType(forms[index] ?? '');
    if (!formType) continue;
    const filingDate = filingDates[index] ?? '';
    const accessionNumber = accessionNumbers[index] ?? '';
    const primaryDocument = primaryDocuments[index] ?? '';
    if (!filingDate || !accessionNumber || !primaryDocument) continue;
    if (filingDate >= params.filingDate) continue;
    if (accessionNumber === params.excludeAccession) continue;
    candidates.push({ accessionNumber, filingDate, formType, primaryDocument });
    if (candidates.length >= MAX_PRIOR_SCAN) break;
  }

  for (const candidate of candidates) {
    const documentUrl = buildStakeDocumentUrl(
      candidate.accessionNumber,
      candidate.primaryDocument,
      targetCompanyCik
    );
    const parsed = await parseStakeFilingDocument({
      accessionNumber: candidate.accessionNumber,
      documentUrl,
      formType: candidate.formType,
      extractItem4: false,
    });
    if (parsed.ownershipPct == null || parsed.parseStatus === 'failed') continue;

    const match: SecPriorFilingMatch = {
      accessionNumber: candidate.accessionNumber,
      filingDate: candidate.filingDate,
      formType: candidate.formType,
      documentUrl,
      ownershipPct: parsed.ownershipPct,
      sharesOwned: parsed.sharesOwned ?? null,
    };

    const cacheRecord: StakeFilingCacheRecord = {
      accessionNumber: candidate.accessionNumber,
      filerCik,
      filerName: params.filerName ?? institutionName,
      targetCompanyCik,
      targetCompanyName: params.targetCompanyName ?? null,
      formType: candidate.formType,
      filingDate: candidate.filingDate,
      ownershipPct: parsed.ownershipPct,
      sharesOwned: parsed.sharesOwned ?? null,
      parseStatus: parsed.parseStatus ?? 'ok',
    };
    await upsertStakeFilingCache(cacheRecord).catch(error => {
      console.warn('[13f-stake] prior cache upsert failed:', error);
    });

    priorLookupCache.set(cacheKey, match);
    return match;
  }

  priorLookupCache.set(cacheKey, null);
  return null;
};

export const invalidateStakeHistoryMemoryCache = (): void => {
  submissionsCache.clear();
  priorLookupCache.clear();
};
