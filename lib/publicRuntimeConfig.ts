export type PublicRuntimeConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
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

/** Load Supabase public config from the backend (Cloud Run runtime env). */
export const loadPublicRuntimeConfig = async (): Promise<PublicRuntimeConfig> => {
  const buildTime = readBuildTimeConfig();
  if (buildTime.supabaseUrl && buildTime.supabaseAnonKey) {
    setPublicRuntimeConfig(buildTime);
    return buildTime;
  }

  try {
    const response = await fetch('/api/public-config', { cache: 'no-store' });
    if (!response.ok) {
      return getPublicRuntimeConfig();
    }
    const data = (await response.json()) as Partial<PublicRuntimeConfig>;
    if (data.supabaseUrl && data.supabaseAnonKey) {
      setPublicRuntimeConfig({
        supabaseUrl: data.supabaseUrl,
        supabaseAnonKey: data.supabaseAnonKey,
      });
    }
  } catch (error) {
    console.warn('Failed to load /api/public-config:', error);
  }

  return getPublicRuntimeConfig();
};
