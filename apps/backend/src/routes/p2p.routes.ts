import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { authenticate, requireKYC, AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { p2pService } from '../services/p2p.service.js';
import { P2PAdType, P2PPriceType, P2POrderStatus } from '../types/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Validation error handler
const handleValidation = (req: Request, res: Response, next: Function) => {
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
 * GET /p2p/ads
 * Get P2P advertisements with filters
 */
router.get(
  '/ads',
  [
    query('type').optional().isIn(['buy', 'sell']),
    query('tokenId').optional().isUUID(),
    query('fiatCurrency').optional().isLength({ min: 3, max: 3 }),
    query('amount').optional().isDecimal(),
    query('country').optional().isLength({ min: 2, max: 3 }),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const filters = {
        type: req.query.type as P2PAdType | undefined,
        tokenId: req.query.tokenId as string | undefined,
        fiatCurrency: req.query.fiatCurrency as string | undefined,
        amount: req.query.amount as string | undefined,
        country: req.query.country as string | undefined,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };

      const result = await p2pService.getAds(filters);

      res.json({
        success: true,
        data: result.ads,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filters.limit),
        },
      });
    } catch (error) {
      logger.error('Failed to fetch P2P ads', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch ads',
        },
      });
    }
  }
);

/**
 * POST /p2p/ads
 * Create a new P2P advertisement
 */
router.post(
  '/ads',
  authenticate,
  requireKYC(1),
  rateLimiters.p2p,
  [
    body('type').isIn(['buy', 'sell']).withMessage('Type must be buy or sell'),
    body('tokenId').isUUID().withMessage('Invalid token ID'),
    body('fiatCurrency').isLength({ min: 3, max: 3 }).withMessage('Invalid currency'),
    body('priceType').isIn(['fixed', 'floating']).withMessage('Invalid price type'),
    body('price').isDecimal().withMessage('Invalid price'),
    body('floatingPriceMargin').optional().isDecimal(),
    body('minAmount').isDecimal().withMessage('Invalid minimum amount'),
    body('maxAmount').isDecimal().withMessage('Invalid maximum amount'),
    body('totalAmount').isDecimal().withMessage('Invalid total amount'),
    body('paymentMethodIds').isArray({ min: 1 }).withMessage('At least one payment method required'),
    body('paymentMethodIds.*').isUUID(),
    body('paymentTimeLimit').optional().isInt({ min: 5, max: 60 }),
    body('remarks').optional().isLength({ max: 500 }),
    body('autoReply').optional().isLength({ max: 200 }),
    body('countries').optional().isArray(),
    body('countries.*').optional().isLength({ min: 2, max: 3 }),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;

      const ad = await p2pService.createAd({
        userId: user.id,
        type: req.body.type,
        tokenId: req.body.tokenId,
        fiatCurrency: req.body.fiatCurrency,
        priceType: req.body.priceType,
        price: req.body.price,
        floatingPriceMargin: req.body.floatingPriceMargin,
        minAmount: req.body.minAmount,
        maxAmount: req.body.maxAmount,
        totalAmount: req.body.totalAmount,
        paymentMethodIds: req.body.paymentMethodIds,
        paymentTimeLimit: req.body.paymentTimeLimit,
        remarks: req.body.remarks,
        autoReply: req.body.autoReply,
        countries: req.body.countries,
      });

      res.status(201).json({
        success: true,
        data: ad,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create ad',
        },
      });
    }
  }
);

/**
 * PATCH /p2p/ads/:adId
 * Update a P2P advertisement
 */
router.patch(
  '/ads/:adId',
  authenticate,
  [
    param('adId').isUUID(),
    body('price').optional().isDecimal(),
    body('minAmount').optional().isDecimal(),
    body('maxAmount').optional().isDecimal(),
    body('status').optional().isIn(['active', 'paused']),
    body('remarks').optional().isLength({ max: 500 }),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { adId } = req.params;

      const ad = await p2pService.updateAd(adId, user.id, req.body);

      res.json({
        success: true,
        data: ad,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update ad',
        },
      });
    }
  }
);

/**
 * DELETE /p2p/ads/:adId
 * Cancel a P2P advertisement
 */
router.delete(
  '/ads/:adId',
  authenticate,
  [param('adId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { adId } = req.params;

      const ad = await p2pService.cancelAd(adId, user.id);

      res.json({
        success: true,
        data: ad,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CANCEL_FAILED',
          message: error instanceof Error ? error.message : 'Failed to cancel ad',
        },
      });
    }
  }
);

/**
 * POST /p2p/orders
 * Create a P2P order
 */
router.post(
  '/orders',
  authenticate,
  requireKYC(1),
  rateLimiters.p2p,
  [
    body('adId').isUUID().withMessage('Invalid ad ID'),
    body('quantity').isDecimal().withMessage('Invalid quantity'),
    body('paymentMethodId').isUUID().withMessage('Invalid payment method'),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;

      const order = await p2pService.createOrder({
        userId: user.id,
        adId: req.body.adId,
        quantity: req.body.quantity,
        paymentMethodId: req.body.paymentMethodId,
      });

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'ORDER_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create order',
        },
      });
    }
  }
);

/**
 * POST /p2p/orders/:orderId/confirm-payment
 * Buyer confirms payment sent
 */
router.post(
  '/orders/:orderId/confirm-payment',
  authenticate,
  [param('orderId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;

      const order = await p2pService.confirmPayment(orderId, user.id);

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CONFIRM_FAILED',
          message: error instanceof Error ? error.message : 'Failed to confirm payment',
        },
      });
    }
  }
);

/**
 * POST /p2p/orders/:orderId/release
 * Seller releases crypto
 */
router.post(
  '/orders/:orderId/release',
  authenticate,
  [param('orderId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;

      const order = await p2pService.releaseCrypto(orderId, user.id);

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'RELEASE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to release crypto',
        },
      });
    }
  }
);

/**
 * POST /p2p/orders/:orderId/cancel
 * Cancel a P2P order
 */
router.post(
  '/orders/:orderId/cancel',
  authenticate,
  [
    param('orderId').isUUID(),
    body('reason').isLength({ min: 1, max: 500 }).withMessage('Reason required'),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;
      const { reason } = req.body;

      const order = await p2pService.cancelOrder(orderId, user.id, reason);

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CANCEL_FAILED',
          message: error instanceof Error ? error.message : 'Failed to cancel order',
        },
      });
    }
  }
);

/**
 * POST /p2p/orders/:orderId/dispute
 * Open a dispute
 */
router.post(
  '/orders/:orderId/dispute',
  authenticate,
  [
    param('orderId').isUUID(),
    body('reason').isLength({ min: 10, max: 1000 }).withMessage('Reason required (10-1000 characters)'),
    body('evidence').optional().isArray(),
    body('evidence.*').optional().isURL(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { orderId } = req.params;
      const { reason, evidence } = req.body;

      const dispute = await p2pService.openDispute(orderId, user.id, reason, evidence);

      res.status(201).json({
        success: true,
        data: dispute,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'DISPUTE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to open dispute',
        },
      });
    }
  }
);

/**
 * GET /p2p/orders
 * Get user's P2P orders
 */
router.get(
  '/orders',
  authenticate,
  [
    query('role').optional().isIn(['buyer', 'seller', 'all']),
    query('status').optional().isIn(['pending', 'payment_pending', 'payment_confirmed', 'completed', 'cancelled', 'disputed']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const role = (req.query.role as 'buyer' | 'seller' | 'all') || 'all';
      const status = req.query.status ? [req.query.status as P2POrderStatus] : undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await p2pService.getUserOrders(user.id, role, status, page, limit);

      res.json({
        success: true,
        data: result.orders,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch orders',
        },
      });
    }
  }
);

export default router;
