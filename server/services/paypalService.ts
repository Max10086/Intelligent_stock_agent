type PayPalTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type PayPalSubscription = {
  id: string;
  plan_id: string;
  status: string;
  custom_id?: string;
  subscriber?: {
    email_address?: string;
    payer_id?: string;
  };
  billing_info?: {
    next_billing_time?: string;
    last_payment?: {
      time?: string;
      amount?: { value?: string; currency_code?: string };
    };
  };
};

const readEnv = (key: string): string => (process.env[key] || '').trim();

export const getPayPalClientId = (): string => readEnv('PAYPAL_CLIENT_ID');

export const getPayPalPlanId = (): string =>
  readEnv('PAYPAL_PLAN_ID') || 'P-4TS20057M6259340FNJJDG2I';

export const isPayPalConfigured = (): boolean =>
  Boolean(getPayPalClientId() && readEnv('PAYPAL_CLIENT_SECRET'));

const getPayPalMode = (): 'live' | 'sandbox' => {
  const mode = readEnv('PAYPAL_MODE').toLowerCase();
  return mode === 'sandbox' ? 'sandbox' : 'live';
};

const getPayPalApiBase = (): string =>
  getPayPalMode() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

const PAYPAL_FETCH_TIMEOUT_MS = 8_000;

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs = PAYPAL_FETCH_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`PayPal API timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

let cachedToken: { value: string; expiresAt: number } | null = null;

const getAccessToken = async (): Promise<string> => {
  if (!isPayPalConfigured()) {
    throw new Error('PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const clientId = getPayPalClientId();
  const clientSecret = readEnv('PAYPAL_CLIENT_SECRET');
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetchWithTimeout(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`PayPal OAuth failed (${response.status}): ${details}`);
  }

  const data = (await response.json()) as PayPalTokenResponse;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
};

export const getPayPalSubscription = async (subscriptionId: string): Promise<PayPalSubscription> => {
  const token = await getAccessToken();
  const response = await fetchWithTimeout(
    `${getPayPalApiBase()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`PayPal subscription lookup failed (${response.status}): ${details}`);
  }

  return (await response.json()) as PayPalSubscription;
};

const ACTIVE_STATUSES = new Set(['ACTIVE', 'APPROVED']);

export const verifyPayPalSubscription = async (
  subscriptionId: string,
  expectedUserId: string,
  expectedPlanId = getPayPalPlanId()
): Promise<PayPalSubscription> => {
  const subscription = await getPayPalSubscription(subscriptionId);

  if (subscription.plan_id !== expectedPlanId) {
    throw new Error('Subscription plan does not match this product');
  }

  if (!ACTIVE_STATUSES.has(subscription.status)) {
    throw new Error(`Subscription is not active (status: ${subscription.status})`);
  }

  if (subscription.custom_id && expectedUserId && subscription.custom_id !== expectedUserId) {
    throw new Error('Subscription is linked to a different account');
  }

  return subscription;
};

export const getPayPalPublicConfig = () => ({
  clientId: getPayPalClientId(),
  planId: getPayPalPlanId(),
  mode: getPayPalMode(),
  configured: isPayPalConfigured(),
});
