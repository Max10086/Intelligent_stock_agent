import React, { useEffect, useState } from 'react';
import type { Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { BrandMark } from './BrandMark.tsx';
import { isValidEmail } from '../utils/authValidation.ts';

type AuthTab = 'signIn' | 'signUp';
type SignUpStep = 'email' | 'verify';

interface LoginPageProps {
  language: Language;
  onSignInWithGoogle: () => Promise<void>;
  onSignInWithEmail: (email: string, password: string) => Promise<void>;
  onSendSignUpCode: (email: string) => Promise<{ devLogged?: boolean } | void>;
  onCompleteSignUp: (email: string, code: string, password: string, confirmPassword: string) => Promise<void>;
  error?: string | null;
  isConfigured: boolean;
}

const RESEND_COOLDOWN_SECONDS = 60;

export const LoginPage: React.FC<LoginPageProps> = ({
  language,
  onSignInWithGoogle,
  onSignInWithEmail,
  onSendSignUpCode,
  onCompleteSignUp,
  error,
  isConfigured,
}) => {
  const ui = getUIText(language);
  const [tab, setTab] = useState<AuthTab>('signIn');
  const [signUpStep, setSignUpStep] = useState<SignUpStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [devCodeHint, setDevCodeHint] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const resetErrors = () => setLocalError(null);

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setSignUpStep('email');
    resetErrors();
  };

  const handleGoogleSignIn = async () => {
    setIsBusy(true);
    resetErrors();
    try {
      await onSignInWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isConfigured || isBusy) return;
    setIsBusy(true);
    resetErrors();
    try {
      await onSignInWithEmail(email, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!isConfigured || isBusy) return;
    if (!isValidEmail(email)) {
      setLocalError(ui.loginInvalidEmail);
      return;
    }
    setIsBusy(true);
    resetErrors();
    try {
      const result = await onSendSignUpCode(email);
      setSignUpStep('verify');
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      setDevCodeHint(Boolean(result && typeof result === 'object' && result.devLogged));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCompleteSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isConfigured || isBusy) return;
    setIsBusy(true);
    resetErrors();
    try {
      await onCompleteSignUp(email, code, password, confirmPassword);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-gray-600 bg-gray-900/80 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800/80 p-8 shadow-2xl">
        <BrandMark language={language} variant="login" />

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg bg-gray-900/60 p-1">
          <button
            type="button"
            onClick={() => switchTab('signIn')}
            className={`rounded-md py-2 text-sm font-medium transition-colors ${
              tab === 'signIn' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {ui.loginTabSignIn}
          </button>
          <button
            type="button"
            onClick={() => switchTab('signUp')}
            className={`rounded-md py-2 text-sm font-medium transition-colors ${
              tab === 'signUp' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {ui.loginTabSignUp}
          </button>
        </div>

        {!isConfigured && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            {ui.loginNotConfigured}
          </div>
        )}

        {(error || localError) && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
            {localError || error}
          </div>
        )}

        {tab === 'signIn' ? (
          <form onSubmit={handleEmailSignIn} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginEmailLabel}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginPasswordLabel}
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
            </div>
            <button
              type="submit"
              disabled={!isConfigured || isBusy}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isBusy ? ui.loginSigningIn : ui.loginSignInWithEmail}
            </button>
          </form>
        ) : signUpStep === 'email' ? (
          <form onSubmit={handleSendCode} className="mt-6 space-y-4">
            <div>
              <label htmlFor="signup-email" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginEmailLabel}
              </label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
            </div>
            <button
              type="submit"
              disabled={!isConfigured || isBusy}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isBusy ? ui.loginSigningIn : ui.loginSendCode}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCompleteSignUp} className="mt-6 space-y-4">
            <p className="text-sm text-green-300">
              {ui.loginCodeSentTo.replace('{email}', email)}
            </p>
            {devCodeHint && (
              <p className="text-sm text-amber-300">{ui.loginCodeDevHint}</p>
            )}
            <div>
              <label htmlFor="signup-code" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginCodeLabel}
              </label>
              <input
                id="signup-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginPasswordLabel}
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
              <p className="mt-1 text-xs text-gray-500">{ui.loginPasswordHint}</p>
            </div>
            <div>
              <label htmlFor="signup-confirm-password" className="block text-sm text-gray-300 mb-1.5">
                {ui.loginConfirmPasswordLabel}
              </label>
              <input
                id="signup-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                className={inputClass}
                disabled={!isConfigured || isBusy}
                required
              />
            </div>
            <button
              type="submit"
              disabled={!isConfigured || isBusy}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isBusy ? ui.loginSigningIn : ui.loginCompleteSignUp}
            </button>
            <button
              type="button"
              disabled={!isConfigured || isBusy || resendSeconds > 0}
              onClick={() => void handleSendCode()}
              className="w-full text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500"
            >
              {resendSeconds > 0
                ? ui.loginResendIn.replace('{seconds}', String(resendSeconds))
                : ui.loginResendCode}
            </button>
            <button
              type="button"
              onClick={() => {
                setSignUpStep('email');
                setCode('');
                resetErrors();
              }}
              className="w-full text-sm text-gray-400 hover:text-gray-200"
            >
              ← {ui.loginEmailLabel}
            </button>
          </form>
        )}

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-700" />
          <span className="text-xs text-gray-500">{ui.loginOrContinueWith}</span>
          <div className="h-px flex-1 bg-gray-700" />
        </div>

        <button
          type="button"
          disabled={!isConfigured || isBusy}
          onClick={() => void handleGoogleSignIn()}
          className="mt-4 w-full flex items-center justify-center gap-3 rounded-lg bg-white text-gray-900 py-3 font-semibold hover:bg-gray-100 disabled:opacity-50"
        >
          <span className="text-lg">G</span>
          {isBusy ? ui.loginSigningIn : ui.loginWithGoogle}
        </button>
      </div>
    </div>
  );
};
