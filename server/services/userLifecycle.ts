import { prisma, withPrismaRetry } from '../db.js';
import { trackUserEvent } from './analytics.js';

export const markFirstAnalysisAt = async (userId: string): Promise<boolean> => {
  const user = await withPrismaRetry(
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { firstAnalysisAt: true },
      }),
    'lifecycle.firstAnalysisLookup',
    2
  );

  if (!user || user.firstAnalysisAt) return false;

  const now = new Date();
  await withPrismaRetry(
    () =>
      prisma.user.update({
        where: { id: userId },
        data: { firstAnalysisAt: now },
      }),
    'lifecycle.firstAnalysisSet',
    2
  );

  void trackUserEvent({
    userId,
    eventType: 'first_analysis',
    metadata: { firstAnalysisAt: now.toISOString() },
  });

  return true;
};

export const markPaidAt = async (userId: string): Promise<boolean> => {
  const user = await withPrismaRetry(
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { paidAt: true },
      }),
    'lifecycle.paidAtLookup',
    2
  );

  if (!user || user.paidAt) return false;

  const now = new Date();
  await withPrismaRetry(
    () =>
      prisma.user.update({
        where: { id: userId },
        data: { paidAt: now },
      }),
    'lifecycle.paidAtSet',
    2
  );

  return true;
};
