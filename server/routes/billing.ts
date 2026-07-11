import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { trackUserEvent } from '../services/analytics.js';
import { getUsageSummary } from '../services/usageLimit.js';
import { getUserProfile } from '../services/userService.js';
import {
  getPayPalPlanId,
  getPayPalPublicConfig,
  getPayPalSubscription,
  verifyPayPalSubscription,
} from '../services/paypalService.js';
import {
  activateUserSubscription,
  deactivateUserSubscription,
  getUserSubscriptionSummary,
} from '../services/subscriptionService.js';

const router = express.Router();

const formatUserResponse = (user: NonNullable<Awaited<ReturnType<typeof getUserProfile>>>) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  isPaid: user.isPaid,
  isAdmin: user.isAdmin,
  paidUntil: user.paidUntil?.toISOString() || null,
  subscriptionStatus: user.subscriptionStatus,
  hasSubscription: Boolean(user.paypalSubscriptionId),
  createdAt: user.createdAt.toISOString(),
});

router.get('/config', requireAuth, (_req, res) => {
  const config = getPayPalPublicConfig();
  if (!config.configured || !config.clientId) {
    return res.status(503).json({
      error: 'PayPal billing is not configured on the server',
      configured: false,
    });
  }
  res.json(config);
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const summary = await getUserSubscriptionSummary(req.user!.id);
    if (!summary) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load subscription status' });
  }
});

router.post('/paypal/activate', requireAuth, async (req, res) => {
  try {
    const subscriptionId = String(req.body?.subscriptionId || '').trim();
    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId is required' });
    }

    const user = await getUserProfile(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.paypalSubscriptionId && user.paypalSubscriptionId !== subscriptionId && user.isPaid) {
      return res.status(409).json({
        error: 'You already have an active subscription on this account',
      });
    }

    const subscription = await verifyPayPalSubscription(subscriptionId, req.user!.id);
    const updated = await activateUserSubscription(req.user!.id, subscription);
    const usage = await getUsageSummary(req.user!.id);

    await trackUserEvent({
      userId: req.user!.id,
      eventType: 'subscription_activated',
      path: '/api/billing/paypal/activate',
      metadata: { subscriptionId, planId: subscription.plan_id, status: subscription.status },
    });

    res.json({
      ok: true,
      user: formatUserResponse(updated),
      usage,
    });
  } catch (error: any) {
    console.error('[billing] PayPal activate failed:', error);
    res.status(400).json({ error: error?.message || 'Failed to activate subscription' });
  }
});

const DEACTIVATE_STATUSES = new Set(['CANCELLED', 'EXPIRED', 'SUSPENDED']);

export const handlePayPalWebhook = async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);

    const payload = JSON.parse(rawBody) as {
      event_type?: string;
      resource?: { id?: string; status?: string; plan_id?: string };
    };

    const eventType = payload.event_type || '';
    const subscriptionId = payload.resource?.id;
    const status = payload.resource?.status || eventType;

    if (!subscriptionId) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
      eventType === 'BILLING.SUBSCRIPTION.RE-ACTIVATED'
    ) {
      const subscription = await getPayPalSubscription(subscriptionId);
      if (subscription.plan_id === getPayPalPlanId() && subscription.custom_id) {
        await activateUserSubscription(subscription.custom_id, subscription);
      }
    } else if (
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED' ||
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      (payload.resource?.status && DEACTIVATE_STATUSES.has(payload.resource.status))
    ) {
      await deactivateUserSubscription(subscriptionId, status);
    }

    res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[billing] PayPal webhook failed:', error);
    res.status(200).json({ ok: true });
  }
};

export { router as billingRouter };
