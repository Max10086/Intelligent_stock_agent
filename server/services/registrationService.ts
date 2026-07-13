import { prisma, withPrismaRetry } from '../db.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { normalizeEmail } from '../../utils/authValidation.js';
import { ensureUserProfile } from './userService.js';
import {
  generateVerificationCode,
  getVerificationCodeTtlMs,
  hashVerificationCode,
  sendRegistrationVerificationEmail,
} from './emailVerification.js';
import type { Language } from '../../types.js';

export const issueRegistrationCode = async (
  email: string,
  language: Language
): Promise<{ devLogged?: boolean }> => {
  const normalizedEmail = normalizeEmail(email);
  const code = generateVerificationCode();
  const codeHash = hashVerificationCode(code);
  const expiresAt = new Date(Date.now() + getVerificationCodeTtlMs());

  await withPrismaRetry(
    () =>
      prisma.$transaction([
        prisma.emailVerificationChallenge.deleteMany({ where: { email: normalizedEmail } }),
        prisma.emailVerificationChallenge.create({
          data: { email: normalizedEmail, codeHash, expiresAt },
        }),
      ]),
    'auth.issueRegistrationCode',
    2
  );

  const delivery = await sendRegistrationVerificationEmail(normalizedEmail, code, language);
  return { devLogged: delivery.devLogged };
};

export const verifyRegistrationCode = async (email: string, code: string): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  const codeHash = hashVerificationCode(code.trim());
  const now = new Date();

  const challenge = await withPrismaRetry(
    () =>
      prisma.emailVerificationChallenge.findFirst({
        where: {
          email: normalizedEmail,
          codeHash,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      }),
    'auth.verifyRegistrationCode',
    2
  );

  if (!challenge) return false;

  await withPrismaRetry(
    () => prisma.emailVerificationChallenge.deleteMany({ where: { email: normalizedEmail } }),
    'auth.clearRegistrationCode',
    2
  );

  return true;
};

export interface EmailRegistrationStatus {
  status: 'available' | 'incomplete' | 'complete';
  userId?: string;
}

export const getEmailRegistrationStatus = async (
  email: string
): Promise<EmailRegistrationStatus> => {
  const normalizedEmail = normalizeEmail(email);
  const rows = await withPrismaRetry(
    () =>
      prisma.$queryRaw<
        Array<{
          id: string;
          has_password: boolean;
        }>
      >`
        SELECT
          u.id,
          (u.encrypted_password IS NOT NULL AND u.encrypted_password <> '') AS has_password
        FROM auth.users u
        WHERE lower(u.email) = ${normalizedEmail}
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
    'auth.getEmailRegistrationStatus',
    2
  );

  if (rows.length === 0) {
    return { status: 'available' };
  }

  const row = rows[0];
  if (row.has_password) {
    return { status: 'complete', userId: row.id };
  }

  return { status: 'incomplete', userId: row.id };
};

export const completeEmailRegistration = async (
  email: string,
  password: string
): Promise<'created' | 'updated'> => {
  const normalizedEmail = normalizeEmail(email);
  const supabase = getSupabaseAdmin();
  const registrationStatus = await getEmailRegistrationStatus(normalizedEmail);

  const syncAppProfile = async (userId: string) => {
    await ensureUserProfile({ id: userId, email: normalizedEmail });
  };

  if (registrationStatus.status === 'available') {
    const { data, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });

    if (error) {
      const message = error.message || 'Failed to create user';
      if (/already been registered|already exists|duplicate/i.test(message)) {
        const retryStatus = await getEmailRegistrationStatus(normalizedEmail);
        if (retryStatus.userId) {
          const { error: updateError } = await supabase.auth.admin.updateUserById(retryStatus.userId, {
            password,
            email_confirm: true,
          });
          if (updateError) throw new Error(updateError.message || 'Failed to update user');
          await syncAppProfile(retryStatus.userId);
          return 'updated';
        }
      }
      throw new Error(message);
    }

    if (data.user?.id) {
      await syncAppProfile(data.user.id);
    }

    return 'created';
  }

  const { error } = await supabase.auth.admin.updateUserById(registrationStatus.userId!, {
    password,
    email_confirm: true,
  });
  if (error) {
    throw new Error(error.message || 'Failed to update user');
  }

  await syncAppProfile(registrationStatus.userId!);

  return 'updated';
};
