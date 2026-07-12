export type PayPalPublicConfig = {
  clientId: string;
  planId: string;
  mode: 'live' | 'sandbox';
  configured: boolean;
};

export type PublicRuntimeConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  paypal?: PayPalPublicConfig;
};

declare global {
  interface Window {
    __PUBLIC_RUNTIME_CONFIG__?: PublicRuntimeConfig;
  }
}

let cachedConfig: PublicRuntimeConfig | null = null;

const readBuildTimeConfig = (): PublicRuntimeConfig => ({
  supabaseUrl:
    import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    '',
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '',
});

export const setPublicRuntimeConfig = (config: PublicRuntimeConfig): void => {
  cachedConfig = config;
  if (typeof window !== 'undefined') {
    window.__PUBLIC_RUNTIME_CONFIG__ = config;
  }
};

export const getPublicRuntimeConfig = (): PublicRuntimeConfig =>
  cachedConfig ||
  (typeof window !== 'undefined' && window.__PUBLIC_RUNTIME_CONFIG__) ||
  readBuildTimeConfig();

export const getPayPalPublicConfig = (): PayPalPublicConfig | null => {
  const config = getPublicRuntimeConfig().paypal;
  if (!config?.configured || !config.clientId || !config.planId) return null;
  return config;
};

let paypalSdkPromise: Promise<void> | null = null;

export const preloadPayPalSdk = (clientId?: string): Promise<void> | null => {
  const resolvedClientId = clientId || getPayPalPublicConfig()?.clientId;
  if (!resolvedClientId) return null;

  if (typeof window !== 'undefined' && window.paypal) {
    return Promise.resolve();
  }

  if (paypalSdkPromise) return paypalSdkPromise;

  const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
  if (existing) {
    paypalSdkPromise = new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load PayPal SDK')));
      if (window.paypal) resolve();
    });
    return paypalSdkPromise;
  }

  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(resolvedClientId)}&vault=true&intent=subscription`;
    script.async = true;
    script.dataset.paypalSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
    document.body.appendChild(script);
  });

  return paypalSdkPromise;
};

/** Load Supabase public config from the backend (Cloud Run runtime env). */
export const loadPublicRuntimeConfig = async (): Promise<PublicRuntimeConfig> => {
  const buildTime = readBuildTimeConfig();
  let merged = { ...buildTime, ...getPublicRuntimeConfig() };

  if (buildTime.supabaseUrl && buildTime.supabaseAnonKey) {
    setPublicRuntimeConfig(merged);
  }

  try {
    const response = await fetch('/api/public-config', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as Partial<PublicRuntimeConfig>;
      merged = {
        supabaseUrl: data.supabaseUrl || merged.supabaseUrl,
        supabaseAnonKey: data.supabaseAnonKey || merged.supabaseAnonKey,
        ...(data.paypal ? { paypal: data.paypal } : {}),
      };
      if (merged.supabaseUrl && merged.supabaseAnonKey) {
        setPublicRuntimeConfig(merged);
      } else if (data.paypal) {
        setPublicRuntimeConfig({
          ...getPublicRuntimeConfig(),
          paypal: data.paypal,
        });
      }
    }
  } catch (error) {
    console.warn('Failed to load /api/public-config:', error);
  }

  const finalConfig = getPublicRuntimeConfig();
  void preloadPayPalSdk();
  return finalConfig;
};
