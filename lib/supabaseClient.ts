import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicRuntimeConfig } from './publicRuntimeConfig.ts';

let supabaseClientInstance: SupabaseClient | null | undefined;

export const isSupabaseConfigured = (): boolean => {
  const { supabaseUrl, supabaseAnonKey } = getPublicRuntimeConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (supabaseClientInstance !== undefined) {
    return supabaseClientInstance;
  }

  const { supabaseUrl, supabaseAnonKey } = getPublicRuntimeConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    supabaseClientInstance = null;
    return null;
  }

  supabaseClientInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return supabaseClientInstance;
};
