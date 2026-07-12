import type { UsageSummary } from '../../types/auth.js';
import { prisma, withPrismaRetry } from '../db.js';
import { getUserProfile } from './userService.js';
import { isSuperAdminUser } from './adminAccess.js';
import { markFirstAnalysisAt } from './userLifecycle.js';

/** First 72 hours after signup: up to this many company analyses, then paywall. */
export const FREE_WINDOW_HOURS = 72;
export const FREE_ANALYSIS_LIMIT = 20;
const PAID_DAILY_LIMIT = 999;
const ADMIN_DAILY_LIMIT = 999_999;

export const utcUsageDate = (date = new Date()): string => date.toISOString().slice(0, 10);

export class UsageLimitError extends Error {
  constructor(
    message: string,
    public summary: UsageSummary
  ) {
    super(message);
    this.name = 'UsageLimitError';
  }
}

const getFreeWindowEndsAt = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + FREE_WINDOW_HOURS * 60 * 60 * 1000);

const isPaidActive = (user: {
  isPaid: boolean;
  paidUntil: Date | null;
  paypalSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
}): boolean => {
  if (!user.isPaid) return false;

  // Recurring PayPal subscription — stay active until webhook marks cancelled/expired.
  if (user.paypalSubscriptionId) {
    const inactive = new Set(['CANCELLED', 'EXPIRED', 'SUSPENDED']);
    if (user.subscriptionStatus && inactive.has(user.subscriptionStatus)) return false;
    return true;
  }

  if (!user.paidUntil) return true;
  return user.paidUntil.getTime() > Date.now();
};

const countAnalysesSinceSignup = async (userId: string, since: Date): Promise<number> =>
  withPrismaRetry(
    () =>
      prisma.companyAnalysisUsage.count({
        where: { userId, createdAt: { gte: since } },
      }),
    'usage.countSinceSignup',
    2
  );

const countAnalysesToday = async (userId: string, usageDate: string): Promise<number> =>
  withPrismaRetry(
    () =>
      prisma.companyAnalysisUsage.count({
        where: { userId, usageDate },
      }),
    'usage.countToday',
    2
  );

export type UserAccessState = {
  limit: number;
  tier: UsageSummary['tier'];
  freeEndsAt: string | null;
  requiresUpgrade: boolean;
  isAdmin: boolean;
  totalFreeUsed: number;
};

export const getUserAccessState = async (
  user: {
    id: string;
    email: string;
    isAdmin?: boolean | null;
    isPaid: boolean;
    paidUntil: Date | null;
    paypalSubscriptionId?: string | null;
    subscriptionStatus?: string | null;
    createdAt: Date;
  }
): Promise<UserAccessState> => {
  if (isSuperAdminUser(user)) {
    return {
      limit: ADMIN_DAILY_LIMIT,
      tier: 'admin',
      freeEndsAt: null,
      requiresUpgrade: false,
      isAdmin: true,
      totalFreeUsed: 0,
    };
  }

  if (isPaidActive(user)) {
    return {
      limit: PAID_DAILY_LIMIT,
      tier: 'paid',
      freeEndsAt: null,
      requiresUpgrade: false,
      isAdmin: false,
      totalFreeUsed: 0,
    };
  }

  const freeEndsAt = getFreeWindowEndsAt(user.createdAt);
  const freeEndsAtIso = freeEndsAt.toISOString();
  const freeWindowOpen = Date.now() < freeEndsAt.getTime();
  const totalFreeUsed = await countAnalysesSinceSignup(user.id, user.createdAt);
  const freeQuotaRemaining = Math.max(0, FREE_ANALYSIS_LIMIT - totalFreeUsed);

  if (freeWindowOpen && freeQuotaRemaining > 0) {
    return {
      limit: FREE_ANALYSIS_LIMIT,
      tier: 'free',
      freeEndsAt: freeEndsAtIso,
      requiresUpgrade: false,
      isAdmin: false,
      totalFreeUsed,
    };
  }

  return {
    limit: 0,
    tier: 'locked',
    freeEndsAt: freeEndsAtIso,
    requiresUpgrade: true,
    isAdmin: false,
    totalFreeUsed,
  };
};

export const getUsageSummary = async (
  userId: string,
  usageDate = utcUsageDate()
): Promise<UsageSummary> => {
  const user = await getUserProfile(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const access = await getUserAccessState(user);
  const usedToday = await countAnalysesToday(userId, usageDate);

  let remaining: number;
  if (access.isAdmin) {
    remaining = ADMIN_DAILY_LIMIT;
  } else if (access.tier === 'paid') {
    remaining = Math.max(0, PAID_DAILY_LIMIT - usedToday);
  } else if (access.tier === 'free') {
    remaining = Math.max(0, FREE_ANALYSIS_LIMIT - access.totalFreeUsed);
  } else {
    remaining = 0;
  }

  return {
    usageDate,
    dailyLimit: access.limit,
    usedToday: access.tier === 'free' ? access.totalFreeUsed : usedToday,
    remaining,
    tier: access.tier,
    freeEndsAt: access.freeEndsAt,
    trialEndsAt: access.freeEndsAt,
    totalFreeUsed: access.totalFreeUsed,
    freeAnalysisLimit: FREE_ANALYSIS_LIMIT,
    requiresUpgrade: access.requiresUpgrade,
    isPaid: access.isAdmin || isPaidActive(user),
    isAdmin: access.isAdmin,
  };
};

const buildLimitMessage = (summary: UsageSummary): string => {
  if (summary.tier === 'locked') {
    const freeEnded =
      summary.freeEndsAt && Date.now() >= new Date(summary.freeEndsAt).getTime();
    if (freeEnded) {
      return 'Your 72-hour free access has ended. Subscribe ($3.8 for 7 days, then $19.8/month) to continue.';
    }
    if ((summary.totalFreeUsed ?? 0) >= FREE_ANALYSIS_LIMIT) {
      return `You've used all ${FREE_ANALYSIS_LIMIT} free company analyses. Subscribe ($3.8 for 7 days, then $19.8/month) to continue.`;
    }
    return 'Subscribe ($3.8 for 7 days, then $19.8/month) to continue analyzing companies.';
  }
  return `Company analysis limit reached (${summary.usedToday}/${summary.dailyLimit}). Subscribe to continue.`;
};

export const assertCanAnalyzeCompanies = async (
  userId: string,
  requestedCompanies: number,
  usageDate = utcUsageDate()
): Promise<UsageSummary> => {
  const summary = await getUsageSummary(userId, usageDate);
  if (requestedCompanies <= 0 || summary.isAdmin) return summary;

  if (summary.requiresUpgrade || summary.tier === 'locked') {
    throw new UsageLimitError(buildLimitMessage(summary), summary);
  }

  if (summary.remaining < requestedCompanies) {
    throw new UsageLimitError(buildLimitMessage(summary), summary);
  }

  return summary;
};

export const recordCompanyAnalysisUsage = async (params: {
  userId: string;
  reportId: string;
  companyId: string;
  ticker: string;
  usageDate?: string;
}) => {
  const usageDate = params.usageDate || utcUsageDate();
  try {
    await withPrismaRetry(
      () =>
        prisma.companyAnalysisUsage.create({
          data: {
            userId: params.userId,
            usageDate,
            reportId: params.reportId,
            companyId: params.companyId,
            ticker: params.ticker,
          },
        }),
      'usage.record',
      2
    );
    void markFirstAnalysisAt(params.userId);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return { recorded: false, duplicate: true };
    }
    throw error;
  }
  return { recorded: true, duplicate: false };
};
