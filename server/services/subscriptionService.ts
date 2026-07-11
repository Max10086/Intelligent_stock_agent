import { prisma, withPrismaRetry } from '../db.js';
import type { PayPalSubscription } from './paypalService.js';
import { getPayPalSubscription, isPayPalConfigured } from './paypalService.js';

export const activateUserSubscription = async (
  userId: string,
  subscription: PayPalSubscription
) => {
  const existingOwner = await withPrismaRetry(
    () =>
      prisma.user.findFirst({
        where: {
          paypalSubscriptionId: subscription.id,
          NOT: { id: userId },
        },
        select: { id: true, email: true },
      }),
    'subscription.ownerLookup'
  );

  if (existingOwner) {
    throw new Error('This PayPal subscription is already linked to another account');
  }

  return withPrismaRetry(
    () =>
      prisma.user.update({
        where: { id: userId },
        data: {
          isPaid: true,
          paidUntil: null,
          paypalSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
        },
      }),
    'subscription.activate'
  );
};

export const deactivateUserSubscription = async (
  subscriptionId: string,
  status: string,
  paidUntil: Date | null = new Date()
) => {
  const user = await withPrismaRetry(
    () => prisma.user.findFirst({ where: { paypalSubscriptionId: subscriptionId } }),
    'subscription.deactivateLookup'
  );

  if (!user) return null;

  return withPrismaRetry(
    () =>
      prisma.user.update({
        where: { id: user.id },
        data: {
          isPaid: false,
          paidUntil,
          subscriptionStatus: status,
        },
      }),
    'subscription.deactivate'
  );
};

export const getUserSubscriptionSummary = async (userId: string) => {
  const user = await withPrismaRetry(
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          isPaid: true,
          paidUntil: true,
          paypalSubscriptionId: true,
          subscriptionStatus: true,
        },
      }),
    'subscription.summary'
  );

  if (!user) return null;

  let nextBillingAt: string | null = null;

  if (user.paypalSubscriptionId && isPayPalConfigured()) {
    try {
      const subscription = await getPayPalSubscription(user.paypalSubscriptionId);
      nextBillingAt = subscription.billing_info?.next_billing_time || null;
    } catch (error) {
      console.warn('[subscription] PayPal billing lookup failed:', error);
    }
  }

  return {
    isPaid: user.isPaid,
    paidUntil: user.paidUntil?.toISOString() || null,
    hasSubscription: Boolean(user.paypalSubscriptionId),
    subscriptionStatus: user.subscriptionStatus,
    nextBillingAt,
  };
};
