import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  formatMissingSupabaseEnvHint,
  getSupabaseEnvStatus,
  getSupabaseServerAuthKeyFromEnv,
  getSupabaseUrlFromEnv,
} from './publicEnv.js';

let adminClient: SupabaseClient | null = null;

export const getSupabaseUrl = (): string => getSupabaseUrlFromEnv();

export const getSupabaseServiceKey = (): string => getSupabaseServerAuthKeyFromEnv();

export const isSupabaseAdminConfigured = (): boolean => getSupabaseEnvStatus().serverAuthReady;

export const resetSupabaseAdminClient = (): void => {
  adminClient = null;
};

export const getSupabaseAdmin = (): SupabaseClient => {
  if (adminClient) return adminClient;
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url || !key) {
    throw new Error(formatMissingSupabaseEnvHint());
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
};

// Re-export for health checks
export { getSupabaseEnvStatus } from './publicEnv.js';
