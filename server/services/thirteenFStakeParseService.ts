import type {
  ThirteenFStakeEnrichment,
  ThirteenFStakeItem4Status,
  ThirteenFStakeParseRequest,
  ThirteenFStakeParseResponse,
  ThirteenFStakeParseStatus,
} from '../../types/thirteenF.js';
import {
  classifyStakeChange,
  computeOwnershipDelta,
  stakeTargetKey,
} from '../../utils/thirteenFStakeChange.js';
import {
  encodeStakeItem4Summary,
  truncatePurposeLabel,
} from '../../utils/thirteenFStakeItem4Display.js';
import { parseStakeFilingsViaPython } from '../lib/stakeFilingParseClient.js';
import {
  findPriorStakeOwnership,
  getStakeFilingCache,
  type StakeFilingCacheRecord,
  upsertStakeFilingCache,
} from './thirteenFStakeCacheService.js';
import { summarizeStakeItem4ViaLlm } from './thirteenFStakeLlmService.js';

const PARSE_BATCH_SIZE = 6;

const is13DForm = (formType: string): boolean => formType.toUpperCase().includes('13D');

const resolveOwnershipParseStatus = (
  hit: StakeFilingCacheRecord | undefined,
  ownershipPct: number | null | undefined
): ThirteenFStakeParseStatus => {
  if (ownershipPct != null) return hit?.parseStatus === 'partial' ? 'partial' : 'ok';
  if (hit?.parseStatus === 'pending') return 'pending';
  return 'failed';
};

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

export const parseStakeOwnershipBatch = async (
  request: ThirteenFStakeParseRequest
): Promise<ThirteenFStakeParseResponse> => {
  const filings = request.filings.filter(row => row.accessionNumber && row.documentUrl);
  if (filings.length === 0) {
    return { enrichments: [] };
  }

  let cached = new Map<string, StakeFilingCacheRecord>();
  try {
    cached = await getStakeFilingCache(filings.map(row => row.accessionNumber));
  } catch (error) {
    console.warn('[13f-stake] cache read failed:', error instanceof Error ? error.message : error);
    cached = new Map();
  }
  const needsParse = filings.filter(row => {
    const hit = cached.get(row.accessionNumber);
    if (!hit) return true;
    if (hit.parseStatus === 'pending' || hit.parseStatus === 'failed') return true;
    // Stale/incomplete cache (e.g. Item 4 saved before ownership parse succeeded).
    if (hit.ownershipPct == null) return true;
    return false;
  });

  const parsedByAccession = new Map<string, Awaited<ReturnType<typeof parseStakeFilingsViaPython>>[number]>();
  for (let offset = 0; offset < needsParse.length; offset += PARSE_BATCH_SIZE) {
    const batch = needsParse.slice(offset, offset + PARSE_BATCH_SIZE);
    const parsed = await parseStakeFilingsViaPython(
      batch.map(row => ({
        accessionNumber: row.accessionNumber,
        documentUrl: row.documentUrl,
        formType: row.formType,
        extractItem4: false,
      }))
    );
    for (const row of parsed) {
      parsedByAccession.set(row.accessionNumber, row);
    }
  }

  const ownershipPctByTarget = new Map<
    string,
    { ownershipPct: number; filingDate: string }
  >();
  const sortedAsc = [...filings].sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  const priorByAccession = new Map<string, number | null>();

  for (const filing of sortedAsc) {
    const targetKey = stakeTargetKey({
      filerCik: filing.filerCik,
      targetCompanyCik: filing.targetCompanyCik,
      targetCompanyName: filing.targetCompanyName,
    });
    const cachedPrior = ownershipPctByTarget.get(targetKey);
    priorByAccession.set(
      filing.accessionNumber,
      cachedPrior && cachedPrior.filingDate < filing.filingDate ? cachedPrior.ownershipPct : null
    );

    const cachedRow = cached.get(filing.accessionNumber);
    const parsedRow = parsedByAccession.get(filing.accessionNumber);
    const ownershipPct =
      parsedRow?.ownershipPct ??
      cachedRow?.ownershipPct ??
      null;
    if (ownershipPct != null) {
      const existing = ownershipPctByTarget.get(targetKey);
      if (!existing || existing.filingDate <= filing.filingDate) {
        ownershipPctByTarget.set(targetKey, { ownershipPct, filingDate: filing.filingDate });
      }
    }
  }

  const enrichments: ThirteenFStakeEnrichment[] = [];

  for (const filing of filings) {
    const cachedRow = cached.get(filing.accessionNumber);
    const parsedRow = parsedByAccession.get(filing.accessionNumber);
    const ownershipPct =
      parsedRow?.ownershipPct ??
      cachedRow?.ownershipPct ??
      null;
    const sharesOwned =
      parsedRow?.sharesOwned ??
      cachedRow?.sharesOwned ??
      null;
    const parseStatus = resolveOwnershipParseStatus(cachedRow, ownershipPct);

    let priorOwnershipPct =
      priorByAccession.get(filing.accessionNumber) ??
      cachedRow?.priorOwnershipPct ??
      null;

    if (priorOwnershipPct == null && ownershipPct != null) {
      try {
        const dbPrior = await findPriorStakeOwnership({
          filerCik: filing.filerCik,
          targetCompanyCik: filing.targetCompanyCik,
          targetCompanyName: filing.targetCompanyName,
          filingDate: filing.filingDate,
          excludeAccession: filing.accessionNumber,
        });
        priorOwnershipPct = dbPrior?.priorOwnershipPct ?? null;
      } catch (error) {
        console.warn('[13f-stake] prior lookup failed:', error instanceof Error ? error.message : error);
      }
    }

    const priorLookupComplete = priorOwnershipPct != null;
    const stakeChangeType = classifyStakeChange({
      formType: filing.formType,
      ownershipPct,
      priorOwnershipPct,
      priorLookupComplete,
    });
    const ownershipDeltaPct = computeOwnershipDelta(ownershipPct, priorOwnershipPct);

    const enrichment: ThirteenFStakeEnrichment = {
      accessionNumber: filing.accessionNumber,
      ownershipPct,
      priorOwnershipPct,
      ownershipDeltaPct,
      sharesOwned,
      stakeChangeType,
      parseStatus,
      item4SummaryStatus: cachedRow?.item4SummaryStatus ?? 'pending',
      item4Summary: cachedRow?.item4Summary ?? null,
    };
    enrichments.push(enrichment);

    try {
      await upsertStakeFilingCache({
        accessionNumber: filing.accessionNumber,
        filerCik: filing.filerCik,
        filerName: filing.filerName,
        targetCompanyCik: filing.targetCompanyCik,
        targetCompanyName: filing.targetCompanyName,
        fileNumber: filing.fileNumber,
        formType: filing.formType,
        filingDate: filing.filingDate,
        ownershipPct,
        priorOwnershipPct,
        sharesOwned,
        stakeChangeType,
        item4Text: cachedRow?.item4Text ?? null,
        item4Summary: cachedRow?.item4Summary ?? null,
        item4SummaryStatus: cachedRow?.item4SummaryStatus ?? 'pending',
        parseStatus,
      });
    } catch (error) {
      console.warn('[13f-stake] cache upsert failed:', error instanceof Error ? error.message : error);
    }
  }

  return { enrichments };
};

export const enrichStakeItem4 = async (params: {
  accessionNumber: string;
  documentUrl: string;
  formType: string;
  filerName: string;
  targetCompanyName?: string | null;
  filingDate?: string;
}): Promise<{ item4Summary: string | null; item4SummaryStatus: ThirteenFStakeItem4Status }> => {
  if (!is13DForm(params.formType)) {
    return { item4Summary: null, item4SummaryStatus: 'skipped' };
  }

  const cached = await getStakeFilingCache([params.accessionNumber]).catch(error => {
    console.warn('[13f-stake] item4 cache read failed:', error instanceof Error ? error.message : error);
    return new Map<string, never>();
  });
  const hit = cached.get(params.accessionNumber);
  if (hit?.item4SummaryStatus === 'ready' && hit.item4Summary) {
    return { item4Summary: hit.item4Summary, item4SummaryStatus: 'ready' };
  }

  let item4Text = hit?.item4Text ?? null;
  if (!item4Text?.trim()) {
    const parsed = await parseStakeFilingsViaPython([
      {
        accessionNumber: params.accessionNumber,
        documentUrl: params.documentUrl,
        formType: params.formType,
        extractItem4: true,
      },
    ]);
    item4Text = parsed[0]?.item4Text ?? null;
  }

  if (!item4Text?.trim()) {
    await upsertStakeFilingCache({
      accessionNumber: params.accessionNumber,
      filerCik: hit?.filerCik ?? 'unknown',
      formType: params.formType,
      filingDate: params.filingDate ?? hit?.filingDate ?? '1970-01-01',
      item4Text,
      item4Summary: null,
      item4SummaryStatus: 'failed',
      parseStatus: hit?.parseStatus ?? 'failed',
    });
    return { item4Summary: null, item4SummaryStatus: 'failed' };
  }

  const llm = await summarizeStakeItem4ViaLlm({
    accessionNumber: params.accessionNumber,
    filerName: params.filerName,
    targetCompanyName: params.targetCompanyName,
    filingDate: params.filingDate,
    item4Text,
  });

  if (llm?.summary) {
    const encodedSummary = encodeStakeItem4Summary({
      label: llm.label || truncatePurposeLabel(llm.summary, 8),
      detail: llm.summary,
    });
    try {
      await upsertStakeFilingCache({
        accessionNumber: params.accessionNumber,
        filerCik: hit?.filerCik ?? 'unknown',
        formType: params.formType,
        filingDate: params.filingDate ?? hit?.filingDate ?? '1970-01-01',
        item4Text,
        item4Summary: encodedSummary,
        item4SummaryStatus: 'ready',
        parseStatus: hit?.ownershipPct != null ? (hit.parseStatus ?? 'partial') : 'failed',
      });
    } catch (error) {
      console.warn('[13f-stake] item4 cache upsert failed:', error instanceof Error ? error.message : error);
    }
    return { item4Summary: encodedSummary, item4SummaryStatus: 'ready' };
  }

  const fallbackDetail = item4Text.replace(/\s+/g, ' ').trim().slice(0, 320);
  const fallback =
    fallbackDetail.length > 0
      ? encodeStakeItem4Summary({
          label: truncatePurposeLabel(fallbackDetail, 8),
          detail: fallbackDetail,
        })
      : null;
  const status: ThirteenFStakeItem4Status = fallback ? 'ready' : 'failed';
  try {
    await upsertStakeFilingCache({
      accessionNumber: params.accessionNumber,
      filerCik: hit?.filerCik ?? 'unknown',
      formType: params.formType,
      filingDate: params.filingDate ?? hit?.filingDate ?? '1970-01-01',
      item4Text,
      item4Summary: fallback,
      item4SummaryStatus: status,
      parseStatus: hit?.ownershipPct != null ? (hit.parseStatus ?? 'partial') : 'failed',
    });
  } catch (error) {
    console.warn('[13f-stake] item4 cache upsert failed:', error instanceof Error ? error.message : error);
  }
  return { item4Summary: fallback, item4SummaryStatus: status };
};

export const enrichStakeItem4Batch = async (
  filings: Array<{
    accessionNumber: string;
    documentUrl: string;
    formType: string;
    filerName: string;
    targetCompanyName?: string | null;
    filingDate?: string;
  }>
): Promise<
  Array<{ accessionNumber: string; item4Summary: string | null; item4SummaryStatus: ThirteenFStakeItem4Status }>
> => {
  const results = await mapWithConcurrency(filings, 1, filing => enrichStakeItem4(filing));
  return filings.map((filing, index) => ({
    accessionNumber: filing.accessionNumber,
    item4Summary: results[index]?.item4Summary ?? null,
    item4SummaryStatus: results[index]?.item4SummaryStatus ?? 'failed',
  }));
};
