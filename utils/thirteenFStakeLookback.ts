import type { ThirteenFStakeLookbackDays } from '../types/thirteenF.ts';

export type { ThirteenFStakeLookbackDays };

export const STAKE_LOOKBACK_OPTIONS: ThirteenFStakeLookbackDays[] = [90, 180, 365, 730, 0];

export const computeStakeSinceDate = (lookbackDays: ThirteenFStakeLookbackDays): string | null => {
  if (lookbackDays <= 0) return null;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  return since.toISOString().slice(0, 10);
};

export const parseStakeLookbackDays = (value: unknown): ThirteenFStakeLookbackDays => {
  const num = Number(value);
  if (num === 90 || num === 180 || num === 365 || num === 730 || num === 0) {
    return num;
  }
  return 180;
};
