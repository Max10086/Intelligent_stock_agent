import type {
  ThirteenFStakeBackfillRequest,
  ThirteenFStakeBackfillResponse,
  ThirteenFStakeEnrichment,
} from '../../types/thirteenF.js';
import {
  classifyStakeChange,
  computeOwnershipDelta,
} from '../../utils/thirteenFStakeChange.js';
import { normalizeStakeTargetCik, sameDayStakeGroupKey } from '../../utils/thirteenFStakeMerge.js';
import { findPriorStakeOwnership, upsertStakeFilingCache } from './thirteenFStakeCacheService.js';
import { findPriorStakeFilingOnSec } from './thirteenFStakeHistoryService.js';

const BACKFILL_CONCURRENCY = 2;

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

const isInitialStakeForm = (formType: string): boolean => {
  const primary = formType.split(' · ')[0] ?? formType;
  return primary === 'SC 13D' || primary === 'SC 13G';
};

const buildEnrichment = (params: {
  accessionNumber: string;
  formType: string;
  ownershipPct: number | null | undefined;
  priorOwnershipPct: number | null | undefined;
  sharesOwned?: number | null;
  parseStatus?: ThirteenFStakeEnrichment['parseStatus'];
  priorLookupComplete: boolean;
}): ThirteenFStakeEnrichment => {
  const stakeChangeType = classifyStakeChange({
    formType: params.formType,
    ownershipPct: params.ownershipPct,
    priorOwnershipPct: params.priorOwnershipPct,
    priorLookupComplete: params.priorLookupComplete,
  });
  return {
    accessionNumber: params.accessionNumber,
    ownershipPct: params.ownershipPct ?? null,
    priorOwnershipPct: params.priorOwnershipPct ?? null,
    ownershipDeltaPct: computeOwnershipDelta(params.ownershipPct, params.priorOwnershipPct),
    sharesOwned: params.sharesOwned ?? null,
    stakeChangeType,
    parseStatus: params.parseStatus,
  };
};

const resolvePriorForFiling = async (filing: ThirteenFStakeBackfillRequest['filings'][number]): Promise<{
  priorOwnershipPct: number | null;
  priorLookupComplete: boolean;
}> => {
  if (filing.ownershipPct == null) {
    return { priorOwnershipPct: null, priorLookupComplete: false };
  }

  const dbPrior = await findPriorStakeOwnership({
    filerCik: filing.filerCik,
    targetCompanyCik: filing.targetCompanyCik,
    targetCompanyName: filing.targetCompanyName,
    filingDate: filing.filingDate,
    excludeAccession: filing.accessionNumber,
  });
  if (dbPrior) {
    return { priorOwnershipPct: dbPrior.priorOwnershipPct, priorLookupComplete: true };
  }

  const targetCompanyCik = normalizeStakeTargetCik(filing.targetCompanyCik);
  if (!targetCompanyCik) {
    return { priorOwnershipPct: null, priorLookupComplete: isInitialStakeForm(filing.formType) };
  }

  const secPrior = await findPriorStakeFilingOnSec({
    filerCik: filing.filerCik,
    filerName: filing.filerName,
    targetCompanyCik,
    targetCompanyName: filing.targetCompanyName,
    filingDate: filing.filingDate,
    excludeAccession: filing.accessionNumber,
  });

  return {
    priorOwnershipPct: secPrior?.ownershipPct ?? null,
    priorLookupComplete: true,
  };
};

/** Async SEC prior backfill — one prior lookup per unique filer+target+date group, cached in DB. */
export const backfillStakePriorBatch = async (
  request: ThirteenFStakeBackfillRequest
): Promise<ThirteenFStakeBackfillResponse> => {
  const filings = request.filings.filter(row => row.accessionNumber && row.filerCik);
  if (filings.length === 0) return { enrichments: [] };

  const groupMap = new Map<string, ThirteenFStakeBackfillRequest['filings'][number]>();
  for (const filing of filings) {
    const key = sameDayStakeGroupKey({
      ...filing,
      id: filing.accessionNumber,
      documentUrl: filing.documentUrl,
      isMajorEvent: 'OTHER',
    });
    if (!groupMap.has(key)) {
      groupMap.set(key, filing);
    }
  }

  const uniqueGroups = [...groupMap.values()];
  const priorByGroupKey = new Map<
    string,
    { priorOwnershipPct: number | null; priorLookupComplete: boolean }
  >();

  await mapWithConcurrency(uniqueGroups, BACKFILL_CONCURRENCY, async filing => {
    const key = sameDayStakeGroupKey({
      ...filing,
      id: filing.accessionNumber,
      documentUrl: filing.documentUrl,
      isMajorEvent: 'OTHER',
    });
    const needsBackfill =
      filing.ownershipPct != null && !isInitialStakeForm(filing.formType);
    if (!needsBackfill) {
      priorByGroupKey.set(key, { priorOwnershipPct: null, priorLookupComplete: true });
      return;
    }
    const prior = await resolvePriorForFiling(filing);
    priorByGroupKey.set(key, prior);
  });

  const enrichments: ThirteenFStakeEnrichment[] = [];

  for (const filing of filings) {
    const key = sameDayStakeGroupKey({
      ...filing,
      id: filing.accessionNumber,
      documentUrl: filing.documentUrl,
      isMajorEvent: 'OTHER',
    });
    const prior = priorByGroupKey.get(key) ?? { priorOwnershipPct: null, priorLookupComplete: false };
    const enrichment = buildEnrichment({
      accessionNumber: filing.accessionNumber,
      formType: filing.formType,
      ownershipPct: filing.ownershipPct,
      priorOwnershipPct: prior.priorOwnershipPct,
      priorLookupComplete: prior.priorLookupComplete,
      parseStatus: filing.ownershipPct != null ? 'ok' : undefined,
    });
    enrichments.push(enrichment);

    if (filing.ownershipPct != null) {
      await upsertStakeFilingCache({
        accessionNumber: filing.accessionNumber,
        filerCik: filing.filerCik,
        filerName: filing.filerName,
        targetCompanyCik: filing.targetCompanyCik,
        targetCompanyName: filing.targetCompanyName,
        formType: filing.formType,
        filingDate: filing.filingDate,
        ownershipPct: filing.ownershipPct,
        priorOwnershipPct: prior.priorOwnershipPct,
        stakeChangeType: enrichment.stakeChangeType,
        parseStatus: 'ok',
      }).catch(error => {
        console.warn('[13f-stake] backfill cache upsert failed:', error);
      });
    }

    for (const mergedAccession of filing.mergedAccessionNumbers ?? []) {
      if (mergedAccession === filing.accessionNumber) continue;
      enrichments.push({
        ...enrichment,
        accessionNumber: mergedAccession,
      });
    }
  }

  return { enrichments };
};
