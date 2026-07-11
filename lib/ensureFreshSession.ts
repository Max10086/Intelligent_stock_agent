import type { Session, SupabaseClient } from '@supabase/supabase-js';

/** Validate with Supabase and refresh the access token when the cached session is stale. */
export const ensureFreshSession = async (client: SupabaseClient): Promise<Session | null> => {
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) {
    return null;
  }

  const { data: sessionResult } = await client.auth.getSession();
  return sessionResult.session;
};
