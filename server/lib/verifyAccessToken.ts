import type { AuthUser } from '../../types/auth.js';
import { getSupabaseAdmin, resetSupabaseAdminClient } from './supabaseAdmin.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export class AuthUpstreamError extends Error {
  readonly upstreamCause?: unknown;

  constructor(message: string, upstreamCause?: unknown) {
    super(message);
    this.name = 'AuthUpstreamError';
    this.upstreamCause = upstreamCause;
  }
}

export type VerifiedAuthUser = AuthUser & {
  userMetadata: Record<string, unknown>;
};

export async function verifyAccessToken(accessToken: string): Promise<VerifiedAuthUser> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let supabase;
      try {
        supabase = getSupabaseAdmin();
      } catch (error) {
        throw new AuthConfigError(
          error instanceof Error ? error.message : 'Supabase admin client is not configured'
        );
      }

      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error || !data.user?.id || !data.user.email) {
        throw new AuthUpstreamError(error?.message || 'Invalid or expired session');
      }
      return {
        id: data.user.id,
        email: data.user.email,
        userMetadata: (data.user.user_metadata || {}) as Record<string, unknown>,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof AuthConfigError) {
        throw error;
      }
      if (error instanceof AuthUpstreamError && /invalid|expired|jwt|token/i.test(error.message)) {
        throw error;
      }
      if (attempt < maxAttempts) {
        resetSupabaseAdminClient();
        await sleep(250 * attempt);
        continue;
      }
    }
  }

  if (lastError instanceof AuthUpstreamError) {
    throw lastError;
  }

  throw new AuthUpstreamError(
    lastError instanceof Error ? lastError.message : 'Supabase auth verification failed',
    lastError
  );
}
