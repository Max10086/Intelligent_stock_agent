import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UsageSummary, UserProfile } from '../types/auth.ts';
import { isSupabaseConfigured, supabaseClient } from '../lib/supabaseClient.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';
import { setAuthTokenGetter } from '../utils/authenticatedFetch.ts';
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
  isLoading: boolean;
  error: string | null;
}

export const useAuth = () => {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    usage: null,
    isLoading: true,
    error: null,
  });

  const syncProfile = useCallback(async (session: Session | null) => {
    if (!session?.access_token) {
      setState(prev => ({ ...prev, user: null, usage: null }));
      return;
    }
    const response = await apiFetch('/api/auth/sync', { method: 'POST' });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    const data = await response.json();
    setState(prev => ({
      ...prev,
      user: data.user as UserProfile,
      usage: data.usage as UsageSummary,
      error: null,
    }));
  }, []);

  const refreshUsage = useCallback(async () => {
    const response = await apiFetch('/api/usage');
    if (!response.ok) return;
    const usage = (await response.json()) as UsageSummary;
    setState(prev => ({ ...prev, usage }));
  }, []);

  useEffect(() => {
    if (!supabaseClient) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Supabase auth is not configured',
      }));
      return;
    }

    let mounted = true;

    const init = async () => {
      if (!supabaseClient) return;
      const { data } = await supabaseClient.auth.getSession();
      if (!mounted) return;
      setState(prev => ({ ...prev, session: data.session, isLoading: false }));
      if (data.session) {
        try {
          await syncProfile(data.session);
        } catch (error) {
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : 'Failed to sync profile',
          }));
        }
      }
    };

    void init();

    const { data: subscription } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({ ...prev, session }));
      setAuthTokenGetter(() => session?.access_token || null);
      if (session) {
        void syncProfile(session).catch(error => {
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : 'Failed to sync profile',
          }));
        });
      } else {
        setState(prev => ({ ...prev, user: null, usage: null, error: null }));
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [syncProfile]);

  useEffect(() => {
    setAuthTokenGetter(() => state.session?.access_token || null);
  }, [state.session?.access_token]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabaseClient) throw new Error('Supabase auth is not configured');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string, language: Language) => {
    if (!supabaseClient) throw new Error('Supabase auth is not configured');

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      throw new Error(language === 'cn' ? '请输入有效邮箱' : 'Enter a valid email address');
    }
    const passwordError = validatePassword(password, language);
    if (passwordError) throw new Error(passwordError);

    const { error } = await supabaseClient.auth.signInWithPassword({
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
      if (!supabaseClient) throw new Error('Supabase auth is not configured');

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
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    setState(prev => ({ ...prev, session: null, user: null, usage: null }));
  }, []);

  const isAuthenticated = Boolean(state.session?.access_token);

  return useMemo(
    () => ({
      ...state,
      isAuthenticated,
      isConfigured: isSupabaseConfigured,
      signInWithGoogle,
      sendSignUpCode,
      completeSignUp,
      signInWithEmail,
      signOut,
      refreshUsage,
    }),
    [state, isAuthenticated, signInWithGoogle, sendSignUpCode, completeSignUp, signInWithEmail, signOut, refreshUsage]
  );
};
