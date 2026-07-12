import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from './auth.js';
import { isSuperAdminUser } from '../services/adminAccess.js';
import { getUserProfile } from '../services/userService.js';

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  requireAuth(req, res, async (authError?: unknown) => {
    if (authError) return;
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const profile = await getUserProfile(req.user.id);
      if (!profile || !isSuperAdminUser(profile)) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      next();
    } catch (error: unknown) {
      console.error('[admin] access check failed:', error);
      return res.status(500).json({ error: 'Failed to verify admin access' });
    }
  });
};
