import type { ThirteenFStakeChangeType } from '../types/thirteenF.ts';

const INITIAL_FORMS = new Set(['SC 13D', 'SC 13G']);

export const classifyStakeChange = (params: {
  formType: string;
  ownershipPct: number | null | undefined;
  priorOwnershipPct: number | null | undefined;
  priorLookupComplete?: boolean;
}): ThirteenFStakeChangeType => {
  const { formType, ownershipPct, priorOwnershipPct, priorLookupComplete } = params;
  if (ownershipPct == null || !Number.isFinite(ownershipPct)) return 'UNKNOWN';

  if (priorOwnershipPct == null || !Number.isFinite(priorOwnershipPct)) {
    if (INITIAL_FORMS.has(formType.split(' · ')[0] ?? formType)) return 'NEW_STAKE';
    if (priorLookupComplete) return 'NEW_STAKE';
    return 'PRIOR_PENDING';
  }

  if (ownershipPct < 5 && priorOwnershipPct >= 5) return 'FELL_BELOW_5';
  if (ownershipPct > priorOwnershipPct) return 'STAKE_INCREASED';
  if (ownershipPct < priorOwnershipPct) return 'STAKE_DECREASED';
  return 'UNCHANGED';
};

export const computeOwnershipDelta = (
  ownershipPct: number | null | undefined,
  priorOwnershipPct: number | null | undefined
): number | null => {
  if (
    ownershipPct == null ||
    priorOwnershipPct == null ||
    !Number.isFinite(ownershipPct) ||
    !Number.isFinite(priorOwnershipPct)
  ) {
    return null;
  }
  return Number((ownershipPct - priorOwnershipPct).toFixed(4));
};

export const stakeTargetKey = (params: {
  filerCik: string;
  targetCompanyCik?: string | null;
  targetCompanyName?: string | null;
}): string => {
  const target =
    params.targetCompanyCik?.trim() ||
    params.targetCompanyName?.trim().toLowerCase() ||
    'unknown-target';
  return `${params.filerCik}::${target}`;
};
