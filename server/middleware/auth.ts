import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../../types/auth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { ensureUserProfile } from '../services/userService.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const extractBearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
};

export const requireAuthLite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.id || !data.user.email) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
    };
    next();
  } catch (error: any) {
    console.error('[auth] requireAuthLite failed:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.id || !data.user.email) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const authUser: AuthUser = {
      id: data.user.id,
      email: data.user.email,
    };
    req.user = authUser;

    const metadata = data.user.user_metadata || {};
    await ensureUserProfile(authUser, {
      displayName:
        (typeof metadata.full_name === 'string' && metadata.full_name) ||
        (typeof metadata.name === 'string' && metadata.name) ||
        null,
      avatarUrl: (typeof metadata.avatar_url === 'string' && metadata.avatar_url) || null,
    });

    next();
  } catch (error: any) {
    console.error('[auth] requireAuth failed:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};
