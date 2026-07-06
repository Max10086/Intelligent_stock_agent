const readEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
};

export type SupabaseEnvStatus = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceRoleKey: boolean;
  serverAuthReady: boolean;
};

/** Resolve Supabase URL from any supported Cloud Run / local env name. */
export function getSupabaseUrlFromEnv(): string {
  return readEnv(
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'VITE_SUPABASE_URL'
  );
}

/** Public anon/publishable key — safe to expose to browsers. */
export function getSupabaseAnonKeyFromEnv(): string {
  return readEnv(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY'
  );
}

/** Service role key for privileged server operations (recommended on Cloud Run). */
export function getSupabaseServiceRoleKeyFromEnv(): string {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY');
}

/** Key used by the server to validate user JWTs (service role preferred, anon fallback). */
export function getSupabaseServerAuthKeyFromEnv(): string {
  return getSupabaseServiceRoleKeyFromEnv() || getSupabaseAnonKeyFromEnv();
}

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  const supabaseUrl = getSupabaseUrlFromEnv();
  const supabaseAnonKey = getSupabaseAnonKeyFromEnv();
  const supabaseServiceRoleKey = getSupabaseServiceRoleKeyFromEnv();
  const serverAuthKey = getSupabaseServerAuthKeyFromEnv();

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
    hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
    serverAuthReady: Boolean(supabaseUrl && serverAuthKey),
  };
}

/** Public Supabase settings safe to expose to the browser (anon/publishable key only). */
export function getPublicSupabaseConfig(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  return {
    supabaseUrl: getSupabaseUrlFromEnv(),
    supabaseAnonKey: getSupabaseAnonKeyFromEnv(),
  };
}

export function formatMissingSupabaseEnvHint(): string {
  const status = getSupabaseEnvStatus();
  const missing: string[] = [];
  if (!status.hasUrl) {
    missing.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!status.hasServiceRoleKey && !status.hasAnonKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  if (missing.length === 0) {
    return 'Supabase server auth is not configured.';
  }
  return `Supabase server auth is not configured. Set ${missing.join(' and ')} on Cloud Run (runtime env, not build-only).`;
}
