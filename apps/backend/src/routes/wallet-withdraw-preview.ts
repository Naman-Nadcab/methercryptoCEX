import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

const ROUND_DOWN = 1;
const AMOUNT_PRECISION = 8;

export interface WithdrawPreviewQuerystring {
  symbol: string;
  chainId?: string;
  amount: string;
  type?: 'onchain' | 'internal';
}

export async function handleWithdrawPreview(
  request: FastifyRequest<{ Querystring: WithdrawPreviewQuerystring }>,
  reply: FastifyReply
) {
  try {
    const { symbol, chainId, amount: amountStr, type = 'onchain' } = request.query;
    let amountDec: DecimalInstance;
    try {
      amountDec = new Decimal(amountStr || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    } catch {
      amountDec = new Decimal(NaN);
    }
    if (!symbol || !amountDec.isFinite() || amountDec.lt(0)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'symbol and amount required' }
      });
    }
    if (type === 'internal') {
      return reply.send({
        success: true,
        data: { fee: '0', net_amount: amountDec.toString(), min_withdrawal: '0', fee_exceeds_amount: false }
      });
    }
    if (!chainId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'chainId required for on-chain preview' }
      });
    }
    const result = await db.query(`
      SELECT t.withdrawal_fee, t.min_withdrawal
      FROM tokens t
      JOIN chains c ON t.chain_id = c.id
      WHERE UPPER(t.symbol) = UPPER($1)
        AND (c.id = $2 OR LOWER(COALESCE(c.id, c.name)) = LOWER($2))
        AND t.is_active = TRUE
      LIMIT 1
    `, [symbol, chainId]);
    if (result.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Token or chain not found' }
      });
    }
    const row = result.rows[0];
    if (!row) throw new Error('Invariant violation: row missing');
    const fee = new Decimal((row as { withdrawal_fee?: string }).withdrawal_fee || '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    const netAmount = Decimal.max(0, amountDec.minus(fee)).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    const feeExceedsAmount = amountDec.gt(0) && fee.gte(amountDec);
    return reply.send({
      success: true,
      data: {
        fee: fee.toString(),
        net_amount: netAmount.toString(),
        min_withdrawal: (row as { min_withdrawal?: string }).min_withdrawal || '0',
        fee_exceeds_amount: feeExceedsAmount
      }
    });
  } catch (error) {
    logger.error('Withdraw preview failed', { error: error instanceof Error ? error.message : 'Unknown' });
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get preview' }
    });
  }
}
