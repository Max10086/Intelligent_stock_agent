import type { Language } from '../types.ts';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

export const validatePassword = (password: string, language: Language): string | null => {
  if (password.length < 8) {
    return language === 'cn' ? '密码至少 8 位' : 'Password must be at least 8 characters';
  }
  return null;
};

export const validateSignUpPasswords = (
  password: string,
  confirmPassword: string,
  language: Language
): string | null => {
  const passwordError = validatePassword(password, language);
  if (passwordError) return passwordError;
  if (password !== confirmPassword) {
    return language === 'cn' ? '两次输入的密码不一致' : 'Passwords do not match';
  }
  return null;
};

export const normalizeOtpCode = (code: string): string => code.trim().replace(/\s/g, '');

export const isValidOtpCode = (code: string): boolean => /^\d{6}$/.test(normalizeOtpCode(code));
