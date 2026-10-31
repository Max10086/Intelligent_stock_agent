import type { ThirteenFStakeFiling } from '../types/thirteenF.ts';
import { normalizeInstitutionCik } from './thirteenFInstitutionSearch.ts';

const FORM_PRIORITY: Record<string, number> = {
  'SC 13D/A': 40,
  'SC 13D': 30,
  'SC 13G/A': 20,
  'SC 13G': 10,
};

export const normalizeStakeTargetCik = (cik: string | null | undefined): string | null => {
  if (!cik?.trim()) return null;
  return normalizeInstitutionCik(cik);
};

export const sameDayStakeGroupKey = (filing: ThirteenFStakeFiling): string => {
  const target =
    normalizeStakeTargetCik(filing.targetCompanyCik) ||
    filing.targetCompanyName?.trim().toLowerCase() ||
    'unknown-target';
  return `${normalizeInstitutionCik(filing.filerCik)}::${target}::${filing.filingDate}`;
};

const formPriority = (formType: string): number => {
  if (formType.includes('13D/A')) return 40;
  if (formType.includes('13D')) return 30;
  if (formType.includes('13G/A')) return 20;
  if (formType.includes('13G')) return 10;
  return 0;
};

const pickPrimaryFiling = (filings: ThirteenFStakeFiling[]): ThirteenFStakeFiling => {
  return [...filings].sort((a, b) => {
    const priorityDelta = formPriority(b.formType) - formPriority(a.formType);
    if (priorityDelta !== 0) return priorityDelta;
    if (a.ownershipPct != null && b.ownershipPct == null) return -1;
    if (b.ownershipPct != null && a.ownershipPct == null) return 1;
    return a.accessionNumber.localeCompare(b.accessionNumber);
  })[0]!;
};

/** Merge same filer + same target + same filing date into one display row. */
export const mergeSameDayStakeFilings = (
  filings: ThirteenFStakeFiling[]
): ThirteenFStakeFiling[] => {
  const groups = new Map<string, ThirteenFStakeFiling[]>();
  for (const filing of filings) {
    const key = sameDayStakeGroupKey(filing);
    const bucket = groups.get(key) ?? [];
    bucket.push(filing);
    groups.set(key, bucket);
  }

  const merged: ThirteenFStakeFiling[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    const primary = pickPrimaryFiling(group);
    const mergedForms = [...new Set(group.map(row => row.formType.split(' · ')[0]!))].sort(
      (a, b) => formPriority(b) - formPriority(a)
    );
    const bestOwnership = group.find(row => row.ownershipPct != null) ?? primary;

    merged.push({
      ...primary,
      id: `merged-${sameDayStakeGroupKey(primary)}`,
      formType: mergedForms.length > 1 ? mergedForms.join(' · ') : primary.formType,
      ownershipPct: bestOwnership.ownershipPct ?? primary.ownershipPct,
      sharesOwned: bestOwnership.sharesOwned ?? primary.sharesOwned,
      priorOwnershipPct: bestOwnership.priorOwnershipPct ?? primary.priorOwnershipPct,
      ownershipDeltaPct: bestOwnership.ownershipDeltaPct ?? primary.ownershipDeltaPct,
      stakeChangeType: bestOwnership.stakeChangeType ?? primary.stakeChangeType,
      parseStatus: bestOwnership.parseStatus ?? primary.parseStatus,
      item4Summary: group.find(row => row.item4Summary)?.item4Summary ?? primary.item4Summary,
      item4SummaryStatus:
        group.find(row => row.item4SummaryStatus === 'ready')?.item4SummaryStatus ??
        primary.item4SummaryStatus,
      mergedAccessionNumbers: group.map(row => row.accessionNumber),
      mergedFormTypes: mergedForms,
    });
  }

  return merged.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
};
