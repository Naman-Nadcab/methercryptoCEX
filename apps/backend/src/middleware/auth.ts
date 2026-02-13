import { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { db } from '../lib/database.js';
import { logger, securityLog } from '../lib/logger.js';
import { UserRole, UserStatus, AuthenticatedRequest } from '../types/index.js';

interface TokenPayload extends JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

/**
 * Verify JWT token and attach user to request
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const token = authHeader.substring(7);

    // Check if token is blacklisted
    const isBlacklisted = await redis.exists(`blacklist:token:${token}`);
    if (isBlacklisted) {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Token has been revoked',
        },
      });
      return;
    }

    // Verify token
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, config.jwt.secret) as TokenPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token has expired',
          },
        });
        return;
      }
      throw error;
    }

    // Verify session is still active
    const sessionKey = `session:${payload.sessionId}`;
    const sessionData = await redis.getJson<{ userId: string; isActive: boolean }>(sessionKey);
    
    if (!sessionData || !sessionData.isActive) {
      res.status(401).json({
        success: false,
        error: {
          code: 'SESSION_INVALID',
          message: 'Session is no longer valid',
        },
      });
      return;
    }

    // Get user status from cache or database
    const userCacheKey = `user:${payload.userId}:status`;
    let userStatus = await redis.get(userCacheKey);

    if (!userStatus) {
      const result = await db.query<{ status: UserStatus }>(
        'SELECT status FROM users WHERE id = $1 AND deleted_at IS NULL',
        [payload.userId]
      );

      if (result.rows.length === 0) {
        res.status(401).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        });
        return;
      }

      userStatus = result.rows[0]!.status;
      await redis.set(userCacheKey, userStatus, 300); // Cache for 5 minutes
    }

    // Check if user is active
    if (userStatus !== UserStatus.ACTIVE) {
      const errorMessages: Record<UserStatus, string> = {
        [UserStatus.PENDING]: 'Account verification pending',
        [UserStatus.SUSPENDED]: 'Account has been suspended',
        [UserStatus.BANNED]: 'Account has been banned',
        [UserStatus.ACTIVE]: '',
      };

      securityLog('blocked_access_attempt', 'medium', {
        userId: payload.userId,
        status: userStatus,
        ip: req.ip,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: errorMessages[userStatus as UserStatus] || 'Account is not active',
        },
      });
      return;
    }

    // Attach user info to request
    (req as AuthenticatedRequest).user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      status: userStatus as UserStatus,
      sessionId: payload.sessionId,
    };

    // Update session last used time
    await redis.set(sessionKey, JSON.stringify({ ...sessionData, lastUsed: Date.now() }), 86400);

    next();
  } catch (error) {
    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : 'Unknown',
      ip: req.ip,
    });
    
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed',
      },
    });
  }
}

/**
 * Optional authentication - attaches user if token present but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  await authenticate(req, res, next);
}

/**
 * Check if user has required role
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      securityLog('unauthorized_access_attempt', 'medium', {
        userId: user.id,
        role: user.role,
        requiredRoles: allowedRoles,
        path: req.path,
        ip: req.ip,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Admin-only middleware with IP whitelist check
 */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;

  if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
      },
    });
    return;
  }

  // Check IP whitelist for admin endpoints in production
  if (config.isProduction) {
    const clientIp = req.ip || req.socket.remoteAddress;
    const isWhitelisted = config.security.adminIpWhitelist.some(
      (ip) => ip === clientIp || ip === '0.0.0.0'
    );

    if (!isWhitelisted) {
      securityLog('admin_access_blocked_ip', 'high', {
        userId: user.id,
        ip: clientIp,
        path: req.path,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'IP_NOT_WHITELISTED',
          message: 'Access denied from this IP address',
        },
      });
      return;
    }
  }

  next();
}

/**
 * Require email verification
 */
export async function requireEmailVerified(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = (req as AuthenticatedRequest).user;

  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const cacheKey = `user:${user.id}:email_verified`;
  let emailVerified = await redis.get(cacheKey);

  if (emailVerified === null) {
    const result = await db.query<{ email_verified: boolean }>(
      'SELECT email_verified FROM users WHERE id = $1',
      [user.id]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }

    emailVerified = result.rows[0]!.email_verified.toString();
    await redis.set(cacheKey, emailVerified, 300);
  }

  if (emailVerified !== 'true') {
    res.status(403).json({
      success: false,
      error: {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email verification required',
      },
    });
    return;
  }

  next();
}

/**
 * Require KYC verification
 */
export function requireKYC(minLevel: number = 1) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const cacheKey = `user:${user.id}:kyc_level`;
    let kycLevel = await redis.get(cacheKey);

    if (kycLevel === null) {
      const result = await db.query<{ level: number; status: string }>(
        "SELECT level, status FROM kyc_records WHERE user_id = $1 AND status = 'approved'",
        [user.id]
      );

      kycLevel = result.rows.length > 0 ? result.rows[0]!.level.toString() : '0';
      await redis.set(cacheKey, kycLevel, 300);
    }

    if (parseInt(kycLevel, 10) < minLevel) {
      res.status(403).json({
        success: false,
        error: {
          code: 'KYC_REQUIRED',
          message: `KYC level ${minLevel} required for this operation`,
          details: { currentLevel: parseInt(kycLevel, 10), requiredLevel: minLevel },
        },
      });
      return;
    }

    next();
  };
}

/**
 * Generate access and refresh tokens
 */
export function generateTokens(
  userId: string,
  email: string,
  role: UserRole,
  sessionId: string
): { accessToken: string; refreshToken: string } {
  const accessOptions: SignOptions = {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
  };
  const accessToken = jwt.sign(
    { userId, email, role, sessionId },
    config.jwt.secret,
    accessOptions
  );

  const refreshOptions: SignOptions = {
    expiresIn: config.jwt.refreshExpiresIn as SignOptions['expiresIn'],
  };
  const refreshToken = jwt.sign(
    { userId, sessionId, type: 'refresh' },
    config.jwt.refreshSecret,
    refreshOptions
  );

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): { userId: string; sessionId: string } | null {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret) as {
      userId: string;
      sessionId: string;
      type: string;
    };

    if (payload.type !== 'refresh') {
      return null;
    }

    return { userId: payload.userId, sessionId: payload.sessionId };
  } catch {
    return null;
  }
}

/**
 * Blacklist a token (for logout)
 */
export async function blacklistToken(token: string): Promise<void> {
  try {
    const decoded = jwt.decode(token) as { exp?: number };
    if (decoded?.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.set(`blacklist:token:${token}`, '1', ttl);
      }
    }
  } catch (error) {
    logger.error('Failed to blacklist token', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }
}
