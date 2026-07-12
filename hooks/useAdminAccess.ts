import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/authenticatedFetch.ts';

const parseAdminFromPayload = (data: {
  user?: { isAdmin?: boolean };
  usage?: { isAdmin?: boolean; tier?: string };
} | null): boolean => {
  if (!data) return false;
  return Boolean(
    data.user?.isAdmin || data.usage?.isAdmin || data.usage?.tier === 'admin'
  );
};

export const useAdminAccess = (enabled: boolean, accessToken: string | null | undefined) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setIsAdmin(false);
      setResolved(false);
      return;
    }

    let cancelled = false;
    setResolved(false);

    const resolveAdmin = async () => {
      try {
        const meResponse = await apiFetch('/api/auth/me');
        if (meResponse.status === 200) {
          const data = await meResponse.json();
          if (!cancelled) {
            setIsAdmin(parseAdminFromPayload(data));
            setResolved(true);
            return;
          }
        }
      } catch {
        // fall through
      }

      try {
        const usageResponse = await apiFetch('/api/usage');
        if (cancelled) return;
        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          setIsAdmin(Boolean(usage.isAdmin || usage.tier === 'admin'));
        } else {
          setIsAdmin(false);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setResolved(true);
      }
    };

    void resolveAdmin();

    return () => {
      cancelled = true;
    };
  }, [enabled, accessToken]);

  return { isAdmin, resolved };
};
