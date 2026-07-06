import crypto from 'crypto';
import nodemailer from 'nodemailer';
import type { Language } from '../../types.js';

export interface EmailDeliveryResult {
  delivered: boolean;
  devLogged?: boolean;
}

const isSmtpConfigured = (): boolean =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const createTransport = () => {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== 'false';
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const buildVerificationEmail = (code: string, language: Language) => {
  const subject =
    language === 'cn'
      ? `【智能股票投研助手】注册验证码 ${code}`
      : `[Intelligent Stock Agent] Verification code ${code}`;
  const text =
    language === 'cn'
      ? `您的注册验证码是：${code}\n\n验证码 10 分钟内有效，请勿泄露给他人。`
      : `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
  const html =
    language === 'cn'
      ? `<p>您的注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效，请勿泄露给他人。</p>`
      : `<p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`;
  return { subject, text, html };
};

export const sendRegistrationVerificationEmail = async (
  email: string,
  code: string,
  language: Language
): Promise<EmailDeliveryResult> => {
  const { subject, text, html } = buildVerificationEmail(code, language);
  const from =
    process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@intelligent-stock-agent.local';

  if (isSmtpConfigured()) {
    const transport = createTransport();
    await transport.sendMail({ from, to: email, subject, text, html });
    return { delivered: true };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info(`[auth] SMTP not configured. Verification code for ${email}: ${code}`);
    return { delivered: true, devLogged: true };
  }

  throw new Error(
    'Email delivery is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS on the server.'
  );
};

export const hashVerificationCode = (code: string): string =>
  crypto.createHash('sha256').update(code).digest('hex');

export const generateVerificationCode = (): string =>
  String(crypto.randomInt(100000, 1000000));

export const getVerificationCodeTtlMs = (): number =>
  Number(process.env.EMAIL_VERIFICATION_TTL_MS || 10 * 60 * 1000);
