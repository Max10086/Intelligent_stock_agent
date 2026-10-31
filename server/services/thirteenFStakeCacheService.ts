import { prisma, withPrismaRetry } from '../db.js';
import type {
  ThirteenFStakeChangeType,
  ThirteenFStakeItem4Status,
  ThirteenFStakeParseStatus,
} from '../../types/thirteenF.js';
import { normalizeInstitutionCik, resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';

export interface StakeFilingCacheRecord {
  accessionNumber: string;
  filerCik: string;
  filerName?: string | null;
  targetCompanyCik?: string | null;
  targetCompanyName?: string | null;
  fileNumber?: string | null;
  formType: string;
  filingDate: string;
  ownershipPct?: number | null;
  priorOwnershipPct?: number | null;
  sharesOwned?: number | null;
  stakeChangeType?: ThirteenFStakeChangeType | null;
  item4Text?: string | null;
  item4Summary?: string | null;
  item4SummaryStatus?: ThirteenFStakeItem4Status;
  parseStatus?: ThirteenFStakeParseStatus;
}

export const getStakeFilingCache = async (
  accessionNumbers: string[]
): Promise<Map<string, StakeFilingCacheRecord>> => {
  const keys = [...new Set(accessionNumbers.filter(Boolean))];
  if (keys.length === 0) return new Map();

  const rows = await withPrismaRetry(
    () =>
      prisma.thirteenFStakeFilingCache.findMany({
        where: { accessionNumber: { in: keys } },
      }),
    'stake-filing.read'
  );

  return new Map(
    rows.map(row => [
      row.accessionNumber,
      {
        accessionNumber: row.accessionNumber,
        filerCik: row.filerCik,
        filerName: row.filerName,
        targetCompanyCik: row.targetCompanyCik,
        targetCompanyName: row.targetCompanyName,
        fileNumber: row.fileNumber,
        formType: row.formType,
        filingDate: row.filingDate,
        ownershipPct: row.ownershipPct,
        priorOwnershipPct: row.priorOwnershipPct,
        sharesOwned: row.sharesOwned,
        stakeChangeType: row.stakeChangeType as ThirteenFStakeChangeType | null | undefined,
        item4Text: row.item4Text,
        item4Summary: row.item4Summary,
        item4SummaryStatus: row.item4SummaryStatus as ThirteenFStakeItem4Status,
        parseStatus: row.parseStatus as ThirteenFStakeParseStatus,
      },
    ])
  );
};

export const findPriorStakeOwnership = async (params: {
  filerCik: string;
  targetCompanyCik?: string | null;
  targetCompanyName?: string | null;
  filingDate: string;
  excludeAccession?: string;
}): Promise<{
  priorOwnershipPct: number;
  priorAccessionNumber: string;
  priorFilingDate: string;
  priorFormType: string | null;
  priorDocumentUrl: string | null;
  priorSharesOwned: number | null;
} | null> => {
  const orConditions: Array<{ targetCompanyCik: string } | { targetCompanyName: string }> = [];
  const normalizedTargetCik = params.targetCompanyCik?.trim()
    ? normalizeInstitutionCik(params.targetCompanyCik.trim())
    : null;

  if (normalizedTargetCik) {
    orConditions.push({ targetCompanyCik: normalizedTargetCik });
  } else if (params.targetCompanyName?.trim()) {
    orConditions.push({ targetCompanyName: params.targetCompanyName.trim() });
  }
  if (orConditions.length === 0) return null;

  const row = await withPrismaRetry(
    () =>
      prisma.thirteenFStakeFilingCache.findFirst({
        where: {
          filerCik: resolveInstitutionCik(params.filerCik),
          filingDate: { lt: params.filingDate },
          ownershipPct: { not: null },
          parseStatus: { in: ['ok', 'partial'] },
          accessionNumber: params.excludeAccession
            ? { not: params.excludeAccession }
            : undefined,
          OR: orConditions,
        },
        orderBy: { filingDate: 'desc' },
      }),
    'stake-filing.prior'
  );

  if (row?.ownershipPct == null) return null;
  return {
    priorOwnershipPct: row.ownershipPct,
    priorAccessionNumber: row.accessionNumber,
    priorFilingDate: row.filingDate,
    priorFormType: row.formType,
    priorDocumentUrl: null,
    priorSharesOwned: row.sharesOwned,
  };
};

export const upsertStakeFilingCache = async (record: StakeFilingCacheRecord): Promise<void> => {
  await withPrismaRetry(
    () =>
      prisma.thirteenFStakeFilingCache.upsert({
        where: { accessionNumber: record.accessionNumber },
        create: {
          accessionNumber: record.accessionNumber,
          filerCik: record.filerCik,
          filerName: record.filerName ?? null,
          targetCompanyCik: record.targetCompanyCik ?? null,
          targetCompanyName: record.targetCompanyName ?? null,
          fileNumber: record.fileNumber ?? null,
          formType: record.formType,
          filingDate: record.filingDate,
          ownershipPct: record.ownershipPct ?? null,
          priorOwnershipPct: record.priorOwnershipPct ?? null,
          sharesOwned: record.sharesOwned ?? null,
          stakeChangeType: record.stakeChangeType ?? null,
          item4Text: record.item4Text ?? null,
          item4Summary: record.item4Summary ?? null,
          item4SummaryStatus: record.item4SummaryStatus ?? 'pending',
          parseStatus: record.parseStatus ?? 'pending',
          parsedAt: new Date(),
        },
        update: {
          filerCik: record.filerCik,
          filerName: record.filerName ?? null,
          targetCompanyCik: record.targetCompanyCik ?? null,
          targetCompanyName: record.targetCompanyName ?? null,
          fileNumber: record.fileNumber ?? null,
          formType: record.formType,
          filingDate: record.filingDate,
          ownershipPct: record.ownershipPct ?? null,
          priorOwnershipPct: record.priorOwnershipPct ?? null,
          sharesOwned: record.sharesOwned ?? null,
          stakeChangeType: record.stakeChangeType ?? null,
          item4Text: record.item4Text ?? undefined,
          item4Summary: record.item4Summary ?? undefined,
          item4SummaryStatus: record.item4SummaryStatus ?? undefined,
          parseStatus: record.parseStatus ?? 'pending',
          parsedAt: new Date(),
        },
      }),
    'stake-filing.upsert'
  );
};

export const updateStakeItem4Summary = async (params: {
  accessionNumber: string;
  item4Summary: string | null;
  item4SummaryStatus: ThirteenFStakeItem4Status;
  item4Text?: string | null;
}): Promise<void> => {
  await withPrismaRetry(
    () =>
      prisma.thirteenFStakeFilingCache.updateMany({
        where: { accessionNumber: params.accessionNumber },
        data: {
          item4Summary: params.item4Summary,
          item4SummaryStatus: params.item4SummaryStatus,
          item4Text: params.item4Text ?? undefined,
        },
      }),
    'stake-filing.item4'
  );
};
