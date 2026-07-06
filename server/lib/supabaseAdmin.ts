import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicSupabaseConfig } from './publicEnv.js';

let adminClient: SupabaseClient | null = null;

export const getSupabaseUrl = (): string => {
  const { supabaseUrl } = getPublicSupabaseConfig();
  return (
    supabaseUrl ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  );
};

export const getSupabaseServiceKey = (): string =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

export const isSupabaseAdminConfigured = (): boolean =>
  Boolean(getSupabaseUrl() && getSupabaseServiceKey());

export const resetSupabaseAdminClient = (): void => {
  adminClient = null;
};

export const getSupabaseAdmin = (): SupabaseClient => {
  if (adminClient) return adminClient;
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.'
    );
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
};
