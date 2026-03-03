/**
 * @deprecated Express trading routes using matching-engine (orders/trades).
 * Production uses spot.fastify + spot-matching.service. Loaded only by index.ts (npm run dev:express).
 */
import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { authenticate, requireKYC } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { matchingEngine } from '../services/matching-engine.service.js';
import { walletService } from '../services/wallet.service.js';
import { db } from '../lib/database.js';
import { OrderSide, OrderType, OrderStatus, TimeInForce, TradingPair } from '../types/index.js';
import { logger } from '../lib/logger.js';

const router: Router = Router();

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
 * GET /trading/pairs
 * Get all trading pairs
 */
router.get('/pairs', async (req: Request, res: Response) => {
  try {
    const result = await db.query<TradingPair & { base_symbol: string; quote_symbol: string }>(
      `SELECT tp.*, 
              bt.symbol as base_symbol, bt.name as base_name,
              qt.symbol as quote_symbol, qt.name as quote_name
       FROM trading_pairs tp
       JOIN tokens bt ON tp.base_token_id = bt.id
       JOIN tokens qt ON tp.quote_token_id = qt.id
       WHERE tp.is_active = TRUE
       ORDER BY tp.symbol`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Failed to fetch trading pairs', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch trading pairs',
      },
    });
  }
});

/**
 * GET /trading/orderbook/:pairId
 * Get orderbook for a trading pair
 */
router.get(
  '/orderbook/:pairId',
  [
    param('pairId').isUUID().withMessage('Invalid pair ID'),
    query('depth').optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const pairId = req.params.pairId;
      if (!pairId) return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'pairId required' } });
      const depth = parseInt(req.query.depth as string) || 50;

      const orderbook = await matchingEngine.getOrderbook(pairId, depth);

      return res.json({
        success: true,
        data: orderbook,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch orderbook',
        },
      });
    }
  }
);

/**
 * GET /trading/trades/:pairId
 * Get recent trades for a trading pair
 */
router.get(
  '/trades/:pairId',
  [
    param('pairId').isUUID().withMessage('Invalid pair ID'),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const pairId = req.params.pairId;
      if (!pairId) return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'pairId required' } });
      const limit = parseInt(req.query.limit as string) || 50;

      const trades = await matchingEngine.getRecentTrades(pairId, limit);

      return res.json({
        success: true,
        data: trades,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch trades',
        },
      });
    }
  }
);

/**
 * POST /trading/orders
 * Place a new order
 */
router.post(
  '/orders',
  authenticate,
  rateLimiters.orders,
  [
    body('pairId').isUUID().withMessage('Invalid pair ID'),
    body('side').isIn(['buy', 'sell']).withMessage('Side must be buy or sell'),
    body('type').isIn(['market', 'limit', 'stop_loss', 'stop_limit']).withMessage('Invalid order type'),
    body('quantity').isDecimal({ decimal_digits: '0,18' }).withMessage('Invalid quantity'),
    body('price')
      .optional()
      .isDecimal({ decimal_digits: '0,18' })
      .withMessage('Invalid price'),
    body('stopPrice')
      .optional()
      .isDecimal({ decimal_digits: '0,18' })
      .withMessage('Invalid stop price'),
    body('timeInForce')
      .optional()
      .isIn(['gtc', 'ioc', 'fok'])
      .withMessage('Invalid time in force'),
    body('clientOrderId')
      .optional()
      .isLength({ max: 64 })
      .withMessage('Client order ID too long'),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { pairId, side, type, quantity, price, stopPrice, timeInForce, clientOrderId } = req.body;

      // Validate price for limit orders
      if ((type === 'limit' || type === 'stop_limit') && !price) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Price required for limit orders',
          },
        });
        return;
      }

      // Validate stop price for stop orders
      if ((type === 'stop_loss' || type === 'stop_limit') && !stopPrice) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Stop price required for stop orders',
          },
        });
        return;
      }

      const result = await matchingEngine.placeOrder({
        userId: user.id,
        pairId,
        side: side as OrderSide,
        type: type as OrderType,
        price,
        stopPrice,
        quantity,
        timeInForce: (timeInForce as TimeInForce) || TimeInForce.GTC,
        clientOrderId,
      });

      res.status(201).json({
        success: true,
        data: {
          order: result.order,
          trades: result.trades,
          status: result.status,
        },
      });
    } catch (error) {
      logger.error('Order placement failed', { 
        error: error instanceof Error ? error.message : 'Unknown',
        userId: (req as AuthenticatedRequest).user?.id,
      });
      
      res.status(400).json({
        success: false,
        error: {
          code: 'ORDER_FAILED',
          message: error instanceof Error ? error.message : 'Order placement failed',
        },
      });
    }
  }
);

/**
 * DELETE /trading/orders/:orderId
 * Cancel an order
 */
router.delete(
  '/orders/:orderId',
  authenticate,
  rateLimiters.trading,
  [param('orderId').isUUID().withMessage('Invalid order ID')],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const orderId = req.params.orderId;
      if (!orderId) return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'orderId required' } });

      const order = await matchingEngine.cancelOrder(orderId, user.id);

      return res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANCEL_FAILED',
          message: error instanceof Error ? error.message : 'Order cancellation failed',
        },
      });
    }
  }
);

/**
 * GET /trading/orders
 * Get user's orders
 */
router.get(
  '/orders',
  authenticate,
  [
    query('pairId').optional().isUUID(),
    query('status').optional().isIn(['open', 'partially_filled', 'filled', 'cancelled']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { pairId, status } = req.query;

      const statusArray = status ? [status as OrderStatus] : undefined;
      const orders = await matchingEngine.getUserOrders(
        user.id,
        pairId as string | undefined,
        statusArray
      );

      res.json({
        success: true,
        data: orders,
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

/**
 * GET /trading/orders/open
 * Get user's open orders
 */
router.get('/orders/open', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;

    const orders = await matchingEngine.getUserOrders(user.id, undefined, [
      OrderStatus.OPEN,
      OrderStatus.PARTIALLY_FILLED,
    ]);

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch open orders',
      },
    });
  }
});

/**
 * GET /trading/history
 * Get user's trade history
 */
router.get(
  '/history',
  authenticate,
  [
    query('pairId').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { pairId } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      let query = `
        SELECT t.*, tp.symbol as pair_symbol
        FROM trades t
        JOIN trading_pairs tp ON t.pair_id = tp.id
        WHERE (t.buyer_id = $1 OR t.seller_id = $1)
      `;
      const params: unknown[] = [user.id];
      let paramIndex = 2;

      if (pairId) {
        query += ` AND t.pair_id = $${paramIndex++}`;
        params.push(pairId);
      }

      query += ` ORDER BY t.executed_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch trade history',
        },
      });
    }
  }
);

/**
 * GET /trading/balances
 * Get user's balances
 */
router.get('/balances', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;

    const balances = await walletService.getBalances(user.id);

    res.json({
      success: true,
      data: balances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch balances',
      },
    });
  }
});

/**
 * GET /trading/wallets
 * Get user's wallet addresses
 */
router.get('/wallets', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;

    const wallets = await walletService.getUserWallets(user.id);

    res.json({
      success: true,
      data: wallets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch wallets',
      },
    });
  }
});

export default router;
