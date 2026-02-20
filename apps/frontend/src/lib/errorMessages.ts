/**
 * Central error code → user message map.
 * Use this for all API error responses so users never see raw codes.
 */

export const ERROR_CODE_MESSAGES: Record<string, string> = {
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please try again in a few minutes.',
  KYC_REQUIRED: 'Identity verification is required to continue.',
  WITHDRAWAL_LIMIT_EXCEEDED: 'You have reached your withdrawal limit. Check your limits in Security settings.',
  COOLDOWN_ACTIVE: 'This action is temporarily unavailable due to a recent security change. Please check the time shown.',
  INSUFFICIENT_BALANCE: 'Insufficient balance to complete this action.',
  INVALID_2FA: 'Invalid two-factor code. Please try again.',
  FUND_PASSWORD_REQUIRED: 'Fund password is required for this action.',
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
  FETCH_FAILED: 'We could not load this information. Please try again.',
  USER_NOT_FOUND: 'Account not found.',
  UPDATE_FAILED: 'Update failed. Please try again.',
  NOT_FOUND: 'The requested item was not found.',
  INVALID_ORDER: 'Invalid order. Check market, side, type, and quantity.',
  MARKET_NOT_FOUND: 'Trading pair not found.',
  MARKET_DISABLED: 'This market is temporarily unavailable.',
  MIN_QTY: 'Quantity is below the minimum for this market.',
  MIN_NOTIONAL: 'Order value is below the minimum for this market.',
  MARKET_NOT_READY: 'Market is not ready for trading.',
  NO_LIQUIDITY: 'No liquidity available for a market order. Try a limit order.',
  ORDER_NOT_CANCELLABLE: 'This order can no longer be cancelled.',
  ORDER_FAILED: 'Order could not be placed. Please try again.',
  CANCEL_FAILED: 'Could not cancel order. Please try again.',
  MARKET_PAUSED: 'Trading is temporarily paused for this market. Please try again later.',
  NETWORK_ERROR: 'Connection issue. Your request may not have reached the server. Safe to try again—no funds have been moved.',
  // Admin (spot markets, etc.)
  UNAUTHORIZED: 'Session expired or not authenticated. Please log in again.',
  INVALID_TOKEN: 'Session expired or invalid. Please log in again.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  ADMIN_IP_NOT_ALLOWED: 'Admin access is not allowed from this IP address.',
  NO_UPDATES: 'No changes to save.',
  INVALID_STATUS: 'Invalid status. Use active, maintenance, or disabled.',
};

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Get a user-facing message for an API error code. Never show raw codes to the user.
 */
export function getErrorMessage(code: string | undefined): string {
  if (!code) return DEFAULT_MESSAGE;
  return ERROR_CODE_MESSAGES[code] ?? DEFAULT_MESSAGE;
}

/**
 * Get user message from API error response shape: { error: { code?, message? } }.
 * Prefers our map for known codes; falls back to server message if safe and no map.
 */
export function getMessageFromApiError(error: { code?: string; message?: string } | undefined): string {
  if (!error) return DEFAULT_MESSAGE;
  const mapped = error.code ? ERROR_CODE_MESSAGES[error.code] : undefined;
  if (mapped) return mapped;
  const msg = typeof error.message === 'string' ? error.message.trim() : '';
  return msg || DEFAULT_MESSAGE;
}
