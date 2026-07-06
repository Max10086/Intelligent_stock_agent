import type { Language } from '../types.ts';

export const mapAuthError = (error: unknown, language: Language): string => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return language === 'cn' ? '邮箱或密码错误' : 'Invalid email or password';
  }
  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return language === 'cn'
      ? '邮箱尚未验证，请先完成注册验证'
      : 'Email is not verified. Complete registration first.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return language === 'cn' ? '该邮箱已注册，请直接登录' : 'This email is already registered. Sign in instead.';
  }
  if (lower.includes('otp expired') || lower.includes('expired')) {
    return language === 'cn' ? '验证码已过期，请重新获取' : 'Verification code expired. Request a new one.';
  }
  if (lower.includes('invalid otp') || lower.includes('token has expired or is invalid')) {
    return language === 'cn' ? '验证码无效，请检查后重试' : 'Invalid verification code';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return language === 'cn' ? '请求过于频繁，请稍后再试' : 'Too many requests. Please try again later.';
  }
  if (lower.includes('signup is disabled')) {
    return language === 'cn' ? '当前不允许新用户注册' : 'Sign up is currently disabled';
  }
  if (lower.includes('password')) {
    return language === 'cn' ? '密码不符合要求，请至少 8 位' : 'Password does not meet requirements';
  }

  return message || (language === 'cn' ? '操作失败，请重试' : 'Something went wrong. Please try again.');
};
