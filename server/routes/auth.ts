import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { trackUserEvent } from '../services/analytics.js';
import { getUsageSummary } from '../services/usageLimit.js';
import { getUserSubscriptionSummaryFast } from '../services/subscriptionService.js';
import { getUserProfile } from '../services/userService.js';
import { isValidEmail, normalizeEmail, validatePassword } from '../../utils/authValidation.js';
import {
  completeEmailRegistration,
  issueRegistrationCode,
  verifyRegistrationCode,
} from '../services/registrationService.js';

const router = express.Router();

const OTP_RESEND_INTERVAL_MS = 60_000;
const OTP_DAILY_LIMIT = 8;
const otpLastSentAt = new Map<string, number>();
const otpDailyCounts = new Map<string, { count: number; dayKey: string }>();

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkOtpRateLimit(email: string): string | null {
  const now = Date.now();
  const lastSent = otpLastSentAt.get(email);
  if (lastSent && now - lastSent < OTP_RESEND_INTERVAL_MS) {
    const seconds = Math.ceil((OTP_RESEND_INTERVAL_MS - (now - lastSent)) / 1000);
    return `Please wait ${seconds} seconds before requesting another code`;
  }

  const dayKey = getDayKey();
  const daily = otpDailyCounts.get(email);
  if (daily?.dayKey === dayKey && daily.count >= OTP_DAILY_LIMIT) {
    return 'Daily verification code limit reached. Try again tomorrow.';
  }

  return null;
}

function recordOtpSend(email: string): void {
  otpLastSentAt.set(email, Date.now());
  const dayKey = getDayKey();
  const daily = otpDailyCounts.get(email);
  if (!daily || daily.dayKey !== dayKey) {
    otpDailyCounts.set(email, { count: 1, dayKey });
    return;
  }
  daily.count += 1;
}

router.post('/register/send-code', async (req, res) => {
  try {
    const email = normalizeEmail(String(req.body?.email || ''));
    const language = req.body?.language === 'cn' ? 'cn' : 'en';
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const rateLimitMessage = checkOtpRateLimit(email);
    if (rateLimitMessage) {
      return res.status(429).json({ error: rateLimitMessage });
    }

    const { devLogged } = await issueRegistrationCode(email, language);
    recordOtpSend(email);
    res.json({ ok: true, devLogged: Boolean(devLogged) });
  } catch (error: any) {
    console.error('[auth] send-code failed:', error);
    res.status(500).json({ error: error?.message || 'Failed to send verification code' });
  }
});

router.post('/register/complete', async (req, res) => {
  try {
    const email = normalizeEmail(String(req.body?.email || ''));
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');
    const language = req.body?.language === 'cn' ? 'cn' : 'en';

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: language === 'cn' ? '请输入 6 位验证码' : 'Enter the 6-digit verification code',
      });
    }
    const passwordError = validatePassword(password, language);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const verified = await verifyRegistrationCode(email, code);
    if (!verified) {
      return res.status(400).json({
        error: language === 'cn' ? '验证码无效或已过期' : 'Invalid or expired verification code',
      });
    }

    try {
      await completeEmailRegistration(email, password);
    } catch (error: any) {
      console.error('[auth] register complete failed:', error);
      return res.status(500).json({ error: error?.message || 'Failed to complete registration' });
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error('[auth] register complete failed:', error);
    res.status(500).json({ error: error?.message || 'Failed to complete registration' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const usage = await getUsageSummary(req.user!.id);
    res.json({
      user: {
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
      },
      usage,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load profile' });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const [user, usage, subscription] = await Promise.all([
      getUserProfile(req.user!.id),
      getUsageSummary(req.user!.id),
      getUserSubscriptionSummaryFast(req.user!.id),
    ]);

    void trackUserEvent({
      userId: req.user!.id,
      eventType: 'login',
      path: '/api/auth/sync',
      metadata: { email: req.user!.email },
    });

    res.json({
      user: {
        id: user!.id,
        email: user!.email,
        displayName: user!.displayName,
        avatarUrl: user!.avatarUrl,
        isPaid: user!.isPaid,
        isAdmin: user!.isAdmin,
        paidUntil: user!.paidUntil?.toISOString() || null,
        subscriptionStatus: user!.subscriptionStatus,
        hasSubscription: Boolean(user!.paypalSubscriptionId),
        createdAt: user!.createdAt.toISOString(),
      },
      usage,
      subscription,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to sync profile' });
  }
});

export { router as authRouter };
