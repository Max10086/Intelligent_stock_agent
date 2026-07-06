import type { AnalyticsEventType } from '../../types/auth.js';
import { prisma, withPrismaRetry } from '../db.js';

export const trackUserEvent = async (params: {
  userId: string;
  eventType: AnalyticsEventType | string;
  path?: string;
  metadata?: Record<string, unknown>;
}) => {
  try {
    await withPrismaRetry(
      () =>
        prisma.userEvent.create({
          data: {
            userId: params.userId,
            eventType: params.eventType,
            path: params.path || null,
            metadata: params.metadata ? JSON.stringify(params.metadata) : null,
          },
        }),
      'analytics.track',
      1
    );
  } catch (error) {
    console.warn('[analytics] Failed to track event:', params.eventType, error);
  }
};
