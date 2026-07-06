import type { UsageSummary } from '../../types/auth.js';
import { prisma, withPrismaRetry } from '../db.js';
import { getUserProfile } from './userService.js';
import { isSuperAdminUser } from './adminAccess.js';

const TRIAL_DAYS = 7;
const TRIAL_DAILY_LIMIT = 10;
const STANDARD_DAILY_LIMIT = 5;
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

const isPaidActive = (user: { isPaid: boolean; paidUntil: Date | null }): boolean => {
  if (!user.isPaid) return false;
  if (!user.paidUntil) return true;
  return user.paidUntil.getTime() > Date.now();
};

export const getDailyLimitForUser = (user: {
  email: string;
  isAdmin?: boolean | null;
  isPaid: boolean;
  paidUntil: Date | null;
  createdAt: Date;
}): { limit: number; tier: UsageSummary['tier']; trialEndsAt: string | null; isAdmin: boolean } => {
  if (isSuperAdminUser(user)) {
    return { limit: ADMIN_DAILY_LIMIT, tier: 'admin', trialEndsAt: null, isAdmin: true };
  }

  if (isPaidActive(user)) {
    return { limit: PAID_DAILY_LIMIT, tier: 'paid', trialEndsAt: null, isAdmin: false };
  }

  const trialEndsAt = new Date(user.createdAt);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_DAYS);

  if (Date.now() < trialEndsAt.getTime()) {
    return {
      limit: TRIAL_DAILY_LIMIT,
      tier: 'trial',
      trialEndsAt: trialEndsAt.toISOString(),
      isAdmin: false,
    };
  }

  return {
    limit: STANDARD_DAILY_LIMIT,
    tier: 'standard',
    trialEndsAt: trialEndsAt.toISOString(),
    isAdmin: false,
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

  const { limit, tier, trialEndsAt, isAdmin } = getDailyLimitForUser(user);
  const usedToday = await withPrismaRetry(
    () =>
      prisma.companyAnalysisUsage.count({
        where: { userId, usageDate },
      }),
    'usage.count',
    2
  );

  const remaining = isAdmin ? ADMIN_DAILY_LIMIT : Math.max(0, limit - usedToday);

  return {
    usageDate,
    dailyLimit: limit,
    usedToday,
    remaining,
    tier,
    trialEndsAt,
    isPaid: isAdmin || isPaidActive(user),
    isAdmin,
  };
};

export const assertCanAnalyzeCompanies = async (
  userId: string,
  requestedCompanies: number,
  usageDate = utcUsageDate()
): Promise<UsageSummary> => {
  const summary = await getUsageSummary(userId, usageDate);
  if (requestedCompanies <= 0 || summary.isAdmin) return summary;

  if (summary.remaining < requestedCompanies) {
    throw new UsageLimitError(
      `Daily company analysis limit reached (${summary.usedToday}/${summary.dailyLimit}). Upgrade to continue.`,
      summary
    );
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
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return { recorded: false, duplicate: true };
    }
    throw error;
  }
  return { recorded: true, duplicate: false };
};
