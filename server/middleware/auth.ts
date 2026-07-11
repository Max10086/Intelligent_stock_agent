import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../../types/auth.js';
import { formatMissingSupabaseEnvHint } from '../lib/publicEnv.js';
import {
  AuthConfigError,
  AuthUpstreamError,
  verifyAccessToken,
} from '../lib/verifyAccessToken.js';
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

const sendAuthFailure = (res: Response, error: unknown, label: string) => {
  if (error instanceof AuthConfigError) {
    console.error(`[auth] ${label} config error:`, error.message);
    return res.status(503).json({
      error: error.message || formatMissingSupabaseEnvHint(),
    });
  }

  if (error instanceof AuthUpstreamError) {
    if (/invalid|expired|jwt|token|session missing/i.test(error.message)) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    console.error(`[auth] ${label} upstream error:`, error.message, error.upstreamCause || '');
    return res.status(503).json({
      error: 'Authentication service temporarily unavailable. Please retry.',
    });
  }

  console.error(`[auth] ${label} failed:`, error);
  return res.status(500).json({ error: 'Authentication failed' });
};

export const requireAuthLite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    req.user = await verifyAccessToken(token);
    next();
  } catch (error: unknown) {
    return sendAuthFailure(res, error, 'requireAuthLite');
  }
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const authUser = await verifyAccessToken(token);
    req.user = authUser;

    try {
      const metadata = authUser.userMetadata || {};
      await ensureUserProfile(authUser, {
        displayName:
          (typeof metadata.full_name === 'string' && metadata.full_name) ||
          (typeof metadata.name === 'string' && metadata.name) ||
          null,
        avatarUrl: (typeof metadata.avatar_url === 'string' && metadata.avatar_url) || null,
      });
    } catch (profileError: unknown) {
      console.error('[auth] ensureUserProfile failed:', profileError);
      return res.status(503).json({
        error: 'Failed to sync user profile. Check database connectivity and migrations.',
      });
    }

    next();
  } catch (error: unknown) {
    return sendAuthFailure(res, error, 'requireAuth');
  }
};
