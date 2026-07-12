import type { AuthUser } from '../../types/auth.js';
import { prisma, withPrismaRetry } from '../db.js';

export const ensureUserProfile = async (
  authUser: AuthUser,
  profile?: {
    displayName?: string | null;
    avatarUrl?: string | null;
  }
): Promise<{ user: Awaited<ReturnType<typeof prisma.user.upsert>>; created: boolean }> => {
  const existing = await withPrismaRetry(
    () => prisma.user.findUnique({ where: { id: authUser.id }, select: { id: true } }),
    'user.lookup',
    2
  );

  const user = await withPrismaRetry(
    () =>
      prisma.user.upsert({
        where: { id: authUser.id },
        create: {
          id: authUser.id,
          email: authUser.email,
          displayName: profile?.displayName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
        },
        update: {
          email: authUser.email,
          ...(profile?.displayName !== undefined ? { displayName: profile.displayName } : {}),
          ...(profile?.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl } : {}),
        },
      }),
    'user.upsert',
    2
  );

  return { user, created: !existing };
};

export const getUserProfile = async (userId: string) =>
  withPrismaRetry(() => prisma.user.findUnique({ where: { id: userId } }), 'user.get', 2);
