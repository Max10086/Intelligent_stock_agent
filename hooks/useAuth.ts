import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { SubscriptionSummary, UsageSummary, UserProfile } from '../types/auth.ts';
import { isSupabaseConfigured, getSupabaseClient } from '../lib/supabaseClient.ts';
import { ensureFreshSession } from '../lib/ensureFreshSession.ts';
import { loadPublicRuntimeConfig } from '../lib/publicRuntimeConfig.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';
import { setAuthTokenGetter, setCachedAccessToken, setSessionRefresher } from '../utils/authenticatedFetch.ts';
import { mapAuthError } from '../utils/authErrors.ts';
import type { Language } from '../types.ts';
import {
  isValidEmail,
  isValidOtpCode,
  normalizeEmail,
  normalizeOtpCode,
  validatePassword,
  validateSignUpPasswords,
} from '../utils/authValidation.ts';

interface AuthState {
  session: Session | null;
  user: UserProfile | null;
  usage: UsageSummary | null;
  subscription: SubscriptionSummary | null;
  isLoading: boolean;
  isProfileSyncing: boolean;
  error: string | null;
}

const profileFromSession = (session: Session): UserProfile => ({
  id: session.user.id,
  email: session.user.email || '',
  displayName: null,
  avatarUrl: null,
  isPaid: false,
  isAdmin: false,
  paidUntil: null,
  createdAt: new Date().toISOString(),
});

export const useAuth = () => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    usage: null,
    subscription: null,
    isLoading: true,
    isProfileSyncing: false,
    error: null,
  });

  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const lastSyncedTokenRef = useRef<string | null>(null);

  const applySessionTokens = useCallback((session: Session | null) => {
    const token = session?.access_token || null;
    setAuthTokenGetter(() => token);
    setCachedAccessToken(token);
  }, []);

  const syncProfile = useCallback(async (session: Session | null) => {
    if (!session?.access_token) {
      lastSyncedTokenRef.current = null;
      setState(prev => ({ ...prev, user: null, usage: null, subscription: null, isProfileSyncing: false }));
      return;
    }

    if (lastSyncedTokenRef.current === session.access_token) {
      return;
    }

    if (syncInFlightRef.current) {
      await syncInFlightRef.current;
      if (lastSyncedTokenRef.current === session.access_token) {
        return;
      }
    }

    setAuthTokenGetter(() => session.access_token);
    setCachedAccessToken(session.access_token);
    setState(prev => ({
      ...prev,
      isProfileSyncing: true,
      user: prev.user?.id === session.user.id ? prev.user : profileFromSession(session),
    }));

    const syncTask = (async () => {
      const response = await apiFetch('/api/auth/sync', { method: 'POST' });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const data = await response.json();
      lastSyncedTokenRef.current = session.access_token;
      setState(prev => ({
        ...prev,
        user: data.user as UserProfile,
        usage: data.usage as UsageSummary,
        subscription: (data.subscription as SubscriptionSummary | null) ?? null,
        isProfileSyncing: false,
        error: null,
      }));
    })();

    syncInFlightRef.current = syncTask;
    try {
      await syncTask;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isProfileSyncing: false,
        error: error instanceof Error ? error.message : 'Failed to sync profile',
      }));
      throw error;
    } finally {
      if (syncInFlightRef.current === syncTask) {
        syncInFlightRef.current = null;
      }
    }
  }, []);

  const refreshUsage = useCallback(async () => {
    const response = await apiFetch('/api/usage');
    if (!response.ok) return;
    const usage = (await response.json()) as UsageSummary;
    setState(prev => ({ ...prev, usage }));
  }, []);

  useEffect(() => {
    let mounted = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const refreshAccessToken = async (): Promise<string | null> => {
      const client = getSupabaseClient();
      if (!client) return null;

      lastSyncedTokenRef.current = null;
      const session = await ensureFreshSession(client);
      if (!session?.access_token) {
        applySessionTokens(null);
        if (mounted) {
          setState(prev => ({
            ...prev,
            session: null,
            user: null,
            usage: null,
            subscription: null,
            isProfileSyncing: false,
          }));
        }
        return null;
      }

      applySessionTokens(session);
      if (mounted) {
        setState(prev => ({
          ...prev,
          session,
          user: prev.user?.id === session.user.id ? prev.user : profileFromSession(session),
          error: null,
        }));
        try {
          await syncProfile(session);
        } catch (error) {
          console.warn('[auth] profile sync after refresh failed:', error);
        }
      }
      return session.access_token;
    };

    setSessionRefresher(refreshAccessToken);

    const init = async () => {
      await loadPublicRuntimeConfig();
      const client = getSupabaseClient();
      if (!client) {
        if (!mounted) return;
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Supabase auth is not configured',
        }));
        return;
      }

      const session = await ensureFreshSession(client);
      if (!mounted) return;

      applySessionTokens(session);
      setState(prev => ({
        ...prev,
        session,
        user: session ? profileFromSession(session) : null,
        isLoading: false,
        error: null,
      }));

      if (session) {
        try {
          await syncProfile(session);
        } catch (error) {
          setState(prev => ({
            ...prev,
            isProfileSyncing: false,
            error: error instanceof Error ? error.message : 'Failed to sync profile',
          }));
        }
      }

      const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
        applySessionTokens(session);
        setState(prev => ({
          ...prev,
          session,
          user: session
            ? prev.user?.id === session.user.id
              ? prev.user
              : profileFromSession(session)
            : null,
        }));
        if (session) {
          void syncProfile(session).catch(error => {
            setState(prev => ({
              ...prev,
              isProfileSyncing: false,
              error: error instanceof Error ? error.message : 'Failed to sync profile',
            }));
          });
        } else {
          lastSyncedTokenRef.current = null;
          setCachedAccessToken(null);
          setState(prev => ({
            ...prev,
            user: null,
            usage: null,
            subscription: null,
            isProfileSyncing: false,
            error: null,
          }));
        }
      });
      authSubscription = subscription.subscription;
    };

    void init();

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
      setSessionRefresher(null);
    };
  }, [applySessionTokens, syncProfile]);

  useEffect(() => {
    applySessionTokens(state.session);
  }, [applySessionTokens, state.session]);

  const signInWithGoogle = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase auth is not configured');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string, language: Language) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase auth is not configured');

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      throw new Error(language === 'cn' ? '请输入有效邮箱' : 'Enter a valid email address');
    }
    const passwordError = validatePassword(password, language);
    if (passwordError) throw new Error(passwordError);

    const { error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) {
      throw new Error(mapAuthError(error, language));
    }
  }, []);

  const sendSignUpCode = useCallback(async (email: string, language: Language) => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error(language === 'cn' ? '请输入有效邮箱' : 'Enter a valid email address');
    }

    const response = await apiFetch('/api/auth/register/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized, language }),
    });
    if (!response.ok) {
      throw new Error(mapAuthError(await readApiError(response), language));
    }
    const data = (await response.json()) as { devLogged?: boolean };
    if (data.devLogged && import.meta.env.DEV) {
      console.info('[auth] SMTP not configured — check the dev server terminal for the verification code.');
    }
    return { devLogged: Boolean(data.devLogged) };
  }, []);

  const completeSignUp = useCallback(
    async (email: string, code: string, password: string, confirmPassword: string, language: Language) => {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase auth is not configured');

      const normalizedEmail = normalizeEmail(email);
      const normalizedCode = normalizeOtpCode(code);
      if (!isValidEmail(normalizedEmail)) {
        throw new Error(language === 'cn' ? '请输入有效邮箱' : 'Enter a valid email address');
      }
      if (!isValidOtpCode(normalizedCode)) {
        throw new Error(language === 'cn' ? '请输入 6 位验证码' : 'Enter the 6-digit verification code');
      }
      const passwordError = validateSignUpPasswords(password, confirmPassword, language);
      if (passwordError) throw new Error(passwordError);

      const response = await apiFetch('/api/auth/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          code: normalizedCode,
          password,
          language,
        }),
      });
      if (!response.ok) {
        throw new Error(mapAuthError(await readApiError(response), language));
      }

      await signInWithEmail(normalizedEmail, password, language);
    },
    [signInWithEmail]
  );

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
    lastSyncedTokenRef.current = null;
    setCachedAccessToken(null);
    setState(prev => ({
      ...prev,
      session: null,
      user: null,
      usage: null,
      subscription: null,
      isProfileSyncing: false,
    }));
  }, []);

  const isAuthenticated = Boolean(state.session?.access_token);

  return useMemo(
    () => ({
      ...state,
      isAuthenticated,
      isConfigured: isSupabaseConfigured(),
      signInWithGoogle,
      sendSignUpCode,
      completeSignUp,
      signInWithEmail,
      signOut,
      refreshUsage,
      refreshProfile: syncProfile,
    }),
    [state, isAuthenticated, signInWithGoogle, sendSignUpCode, completeSignUp, signInWithEmail, signOut, refreshUsage, syncProfile]
  );
};
