import { Prisma } from '@prisma/client';
import { prisma, withPrismaRetry } from '../db.js';
import { isSuperAdminUser } from './adminAccess.js';

const INACTIVE_SUBSCRIPTION_STATUSES = new Set(['CANCELLED', 'EXPIRED', 'SUSPENDED']);

const parseDateParam = (value: string | undefined, fallback: Date): Date => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const isPaidUser = (user: {
  isPaid: boolean;
  subscriptionStatus: string | null;
  paypalSubscriptionId: string | null;
}): boolean => {
  if (!user.isPaid) return false;
  if (user.paypalSubscriptionId && user.subscriptionStatus) {
    return !INACTIVE_SUBSCRIPTION_STATUSES.has(user.subscriptionStatus);
  }
  return true;
};

export interface AdminMetricsQuery {
  from?: string;
  to?: string;
}

/** KPIs and trends only — no per-user table (loaded separately). */
export const getAdminMetrics = async (query: AdminMetricsQuery) => {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDateParam(query.from, defaultFrom);
  const to = parseDateParam(query.to, now);
  const wauFrom = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  return withPrismaRetry(async () => {
    const [
      authSignupRows,
      totalRegistered,
      activatedUsers,
      activatedInPeriod,
      paidProfiles,
      usageInPeriod,
      usageTotal,
      topTickerRows,
      hitPaywallRows,
      paidActivationsInPeriod,
      signupsByDayRows,
      paidByDayRows,
      analysesByDayRows,
      wauRows,
    ] = await Promise.all([
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM auth.users
        WHERE deleted_at IS NULL
          AND created_at >= ${from}
          AND created_at <= ${to}
      `,
      prisma.user.count(),
      prisma.user.count({ where: { firstAnalysisAt: { not: null } } }),
      prisma.user.count({
        where: { firstAnalysisAt: { gte: from, lte: to } },
      }),
      prisma.user.findMany({
        select: {
          email: true,
          isPaid: true,
          subscriptionStatus: true,
          paypalSubscriptionId: true,
          isAdmin: true,
        },
      }),
      prisma.companyAnalysisUsage.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      prisma.companyAnalysisUsage.count(),
      prisma.companyAnalysisUsage.groupBy({
        by: ['ticker'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { ticker: true },
        orderBy: { _count: { ticker: 'desc' } },
        take: 10,
      }),
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT "userId")::int AS count
        FROM "UserEvent"
        WHERE "eventType" = 'usage_limit_hit'
          AND "createdAt" >= ${from}
          AND "createdAt" <= ${to}
      `,
      prisma.user.count({
        where: { paidAt: { gte: from, lte: to } },
      }),
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT DATE(created_at) AS day, COUNT(*)::int AS count
        FROM auth.users
        WHERE deleted_at IS NULL
          AND created_at >= ${from}
          AND created_at <= ${to}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT DATE("paidAt") AS day, COUNT(*)::int AS count
        FROM "User"
        WHERE "paidAt" IS NOT NULL
          AND "paidAt" >= ${from}
          AND "paidAt" <= ${to}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: Date; count: number }>>`
        SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
        FROM "CompanyAnalysisUsage"
        WHERE "createdAt" >= ${from}
          AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT "userId")::int AS count
        FROM "UserEvent"
        WHERE "createdAt" >= ${wauFrom}
          AND "createdAt" <= ${to}
          AND "eventType" IN ('login', 'analysis_complete', 'page_view', 'analysis_start')
      `,
    ]);

    const totalPaidUsers = paidProfiles.filter(
      user => isPaidUser(user) && !isSuperAdminUser(user)
    ).length;
    const signups = authSignupRows[0]?.count ?? 0;
    const hitPaywall = hitPaywallRows[0]?.count ?? 0;
    const wau = wauRows[0]?.count ?? 0;

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      growth: {
        signups,
        activatedInPeriod,
        wau,
      },
      revenue: {
        newPaidUsers: paidActivationsInPeriod,
        totalPaidUsers,
        conversionRate:
          totalRegistered > 0 ? Number((totalPaidUsers / totalRegistered).toFixed(4)) : 0,
      },
      usage: {
        totalAnalyses: usageTotal,
        analysesInPeriod: usageInPeriod,
        avgAnalysesPerUser:
          totalRegistered > 0 ? Number((usageTotal / totalRegistered).toFixed(2)) : 0,
        topTickers: topTickerRows.map(row => ({
          ticker: row.ticker,
          count: row._count.ticker,
        })),
      },
      funnel: {
        registered: totalRegistered,
        activated: activatedUsers,
        hitPaywall,
        paid: totalPaidUsers,
      },
      trends: {
        signupsByDay: signupsByDayRows.map(row => ({
          date: toIsoDate(new Date(row.day)),
          count: row.count,
        })),
        paidByDay: paidByDayRows.map(row => ({
          date: toIsoDate(new Date(row.day)),
          count: row.count,
        })),
        analysesByDay: analysesByDayRows.map(row => ({
          date: toIsoDate(new Date(row.day)),
          count: row.count,
        })),
      },
    };
  }, 'admin.metrics', 2);
};

export interface AdminUsersQuery {
  skip?: number;
  limit?: number;
}

export const listAdminUsers = async (query: AdminUsersQuery = {}) => {
  const skip = Math.max(0, query.skip ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));

  return withPrismaRetry(async () => {
    const [total, users] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          createdAt: true,
          firstAnalysisAt: true,
          paidAt: true,
          isPaid: true,
          subscriptionStatus: true,
          paypalSubscriptionId: true,
          isAdmin: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const userIds = users.map(user => user.id);
    if (userIds.length === 0) {
      return { total, skip, limit, users: [] };
    }

    const [analysisCounts, lastActiveRows] = await Promise.all([
      prisma.companyAnalysisUsage.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ userId: string; lastActive: Date | null }>>`
        SELECT "userId", MAX("createdAt") AS "lastActive"
        FROM "UserEvent"
        WHERE "userId" IN (${Prisma.join(userIds)})
        GROUP BY "userId"
      `,
    ]);

    const analysisMap = new Map(
      analysisCounts.map(row => [row.userId, row._count._all])
    );
    const lastActiveMap = new Map(
      lastActiveRows.map(row => [row.userId, row.lastActive?.toISOString() || null])
    );

    return {
      total,
      skip,
      limit,
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        firstAnalysisAt: user.firstAnalysisAt?.toISOString() || null,
        paidAt: user.paidAt?.toISOString() || null,
        isPaid: isPaidUser(user),
        isAdmin: isSuperAdminUser(user),
        totalAnalyses: analysisMap.get(user.id) ?? 0,
        lastActiveAt: lastActiveMap.get(user.id) || null,
      })),
    };
  }, 'admin.users', 2);
};

export const listAdminFeedback = async (params?: { limit?: number }) => {
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  return withPrismaRetry(
    () =>
      prisma.userFeedback.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { email: true, isPaid: true },
          },
        },
      }),
    'admin.feedbackList',
    2
  );
};
