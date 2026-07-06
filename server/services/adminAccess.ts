const parseSuperAdminEmails = (): Set<string> => {
  const raw = process.env.SUPER_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
};

/** DB flag or SUPER_ADMIN_EMAILS env (comma-separated, case-insensitive). */
export const isSuperAdminUser = (user: {
  email: string;
  isAdmin?: boolean | null;
}): boolean => {
  if (user.isAdmin) return true;
  return parseSuperAdminEmails().has(user.email.trim().toLowerCase());
};
