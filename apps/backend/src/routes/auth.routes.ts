import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authService } from '../services/auth.service.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AuthProvider } from '../types/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Validation middleware
const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: errors.array(),
      },
    });
    return;
  }
  next();
};

/**
 * POST /auth/signup
 * Register new user with email/password
 */
router.post(
  '/signup',
  rateLimiters.auth,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
    body('phone').optional().isMobilePhone('any').withMessage('Valid phone number required'),
    body('referralCode').optional().isLength({ min: 6, max: 10 }).toUpperCase(),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { email, password, phone, referralCode } = req.body;

      const result = await authService.signup({
        email,
        password,
        phone,
        referralCode,
        provider: AuthProvider.EMAIL,
      });

      res.status(201).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (error) {
      logger.error('Signup failed', { error: error instanceof Error ? error.message : 'Unknown' });
      res.status(400).json({
        success: false,
        error: {
          code: 'SIGNUP_FAILED',
          message: error instanceof Error ? error.message : 'Signup failed',
        },
      });
    }
  }
);

/**
 * POST /auth/login
 * Login with email/password
 */
router.post(
  '/login',
  rateLimiters.auth,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      const result = await authService.login({
        email,
        password,
        ip: req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: {
          code: 'LOGIN_FAILED',
          message: error instanceof Error ? error.message : 'Login failed',
        },
      });
    }
  }
);

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token required')],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;

      const tokens = await authService.refreshToken(refreshToken, req.ip || '127.0.0.1');

      res.json({
        success: true,
        data: tokens,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: {
          code: 'REFRESH_FAILED',
          message: error instanceof Error ? error.message : 'Token refresh failed',
        },
      });
    }
  }
);

/**
 * POST /auth/logout
 * Logout current session
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const token = req.headers.authorization?.substring(7) || '';

    await authService.logout(user.sessionId, token);

    res.json({
      success: true,
      data: { message: 'Logged out successfully' },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Logout failed',
      },
    });
  }
});

/**
 * POST /auth/logout-all
 * Logout all sessions
 */
router.post('/logout-all', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;

    await authService.logoutAll(user.id);

    res.json({
      success: true,
      data: { message: 'All sessions logged out' },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Logout failed',
      },
    });
  }
});

/**
 * POST /auth/otp/send
 * Send OTP for verification
 */
router.post(
  '/otp/send',
  rateLimiters.otp,
  [
    body('identifier').notEmpty().withMessage('Email or phone required'),
    body('type')
      .isIn(['email', 'phone', 'password_reset', 'two_factor'])
      .withMessage('Invalid OTP type'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { identifier, type, userId } = req.body;

      const result = await authService.generateOTP({ identifier, type, userId });

      res.json({
        success: true,
        data: {
          message: 'OTP sent successfully',
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'OTP_SEND_FAILED',
          message: error instanceof Error ? error.message : 'Failed to send OTP',
        },
      });
    }
  }
);

/**
 * POST /auth/otp/verify
 * Verify OTP
 */
router.post(
  '/otp/verify',
  rateLimiters.otp,
  [
    body('identifier').notEmpty().withMessage('Email or phone required'),
    body('type')
      .isIn(['email', 'phone', 'password_reset', 'two_factor'])
      .withMessage('Invalid OTP type'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { identifier, type, otp } = req.body;

      const result = await authService.verifyOTP(identifier, type, otp);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'OTP_VERIFY_FAILED',
          message: error instanceof Error ? error.message : 'OTP verification failed',
        },
      });
    }
  }
);

/**
 * POST /auth/password/change
 * Change password (authenticated)
 */
router.post(
  '/password/change',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { currentPassword, newPassword } = req.body;

      await authService.changePassword(
        user.id,
        currentPassword,
        newPassword,
        req.ip || '127.0.0.1'
      );

      res.json({
        success: true,
        data: { message: 'Password changed successfully' },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'PASSWORD_CHANGE_FAILED',
          message: error instanceof Error ? error.message : 'Password change failed',
        },
      });
    }
  }
);

/**
 * POST /auth/password/reset
 * Reset password with OTP
 */
router.post(
  '/password/reset',
  rateLimiters.auth,
  [
    body('identifier').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
  ],
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { identifier, otp, newPassword } = req.body;

      await authService.resetPassword(identifier, otp, newPassword);

      res.json({
        success: true,
        data: { message: 'Password reset successfully' },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'PASSWORD_RESET_FAILED',
          message: error instanceof Error ? error.message : 'Password reset failed',
        },
      });
    }
  }
);

/**
 * GET /auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = await authService.getUserById(authReq.user.id);

    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch user info',
      },
    });
  }
});

export default router;
