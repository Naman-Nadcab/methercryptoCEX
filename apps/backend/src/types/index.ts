import { Request } from 'express';

// ============================================
// User Types
// ============================================
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
}

export enum AuthProvider {
  EMAIL = 'email',
  GOOGLE = 'google',
  APPLE = 'apple',
}

export interface User {
  id: string;
  email: string;
  phone?: string;
  passwordHash?: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  referralCode: string;
  referredBy?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
}

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    sessionId: string;
  };
}

// ============================================
// KYC Types
// ============================================
export enum KYCStatus {
  NOT_STARTED = 'not_started',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REQUIRES_RESUBMISSION = 'requires_resubmission',
}

export enum KYCLevel {
  NONE = 0,
  BASIC = 1,
  ADVANCED = 2,
  PROFESSIONAL = 3,
}

export interface KYCRecord {
  id: string;
  userId: string;
  status: KYCStatus;
  level: KYCLevel;
  panNumber?: string;
  panVerified: boolean;
  aadhaarNumber?: string;
  aadhaarVerified: boolean;
  livenessScore?: number;
  livenessVerified: boolean;
  geoLocation?: {
    latitude: number;
    longitude: number;
    country: string;
    state: string;
    city: string;
  };
  rejectionReason?: string;
  documents: KYCDocument[];
  submittedAt?: Date;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KYCDocument {
  id: string;
  type: 'pan' | 'aadhaar_front' | 'aadhaar_back' | 'selfie' | 'liveness_video';
  url: string;
  verified: boolean;
  uploadedAt: Date;
}

// ============================================
// Wallet Types
// ============================================
export enum ChainType {
  EVM = 'evm',
  SOLANA = 'solana',
  TRON = 'tron',
  BITCOIN = 'bitcoin',
  POLKADOT = 'polkadot',
}

export enum ChainId {
  ETHEREUM = 'ethereum',
  BSC = 'bsc',
  POLYGON = 'polygon',
  ARBITRUM = 'arbitrum',
  OPTIMISM = 'optimism',
  BASE = 'base',
  SOLANA = 'solana',
  TRON = 'tron',
  BITCOIN = 'bitcoin',
  POLKADOT = 'polkadot',
}

export interface Chain {
  id: ChainId;
  name: string;
  type: ChainType;
  nativeCurrency: string;
  decimals: number;
  rpcUrl: string;
  explorerUrl: string;
  isActive: boolean;
  confirmationsRequired: number;
}

export interface Token {
  id: string;
  symbol: string;
  name: string;
  chainId: ChainId;
  contractAddress?: string; // null for native tokens
  decimals: number;
  isActive: boolean;
  isNative: boolean;
  iconUrl?: string;
}

export interface Wallet {
  id: string;
  userId: string;
  chainId: ChainId;
  address: string;
  encryptedPrivateKey: string;
  hdPath: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Balance {
  id: string;
  userId: string;
  tokenId: string;
  available: string; // Using string for precise decimal handling
  locked: string;
  total: string;
  updatedAt: Date;
}

// ============================================
// Order Types
// ============================================
export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  STOP_LIMIT = 'stop_limit',
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REJECTED = 'rejected',
}

export enum TimeInForce {
  GTC = 'gtc', // Good Till Cancelled
  IOC = 'ioc', // Immediate Or Cancel
  FOK = 'fok', // Fill Or Kill
}

export interface TradingPair {
  id: string;
  symbol: string; // e.g., 'BTC_USDT'
  baseTokenId: string;
  quoteTokenId: string;
  minOrderSize: string;
  maxOrderSize: string;
  tickSize: string; // Minimum price increment
  stepSize: string; // Minimum quantity increment
  makerFee: string;
  takerFee: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Order {
  id: string;
  userId: string;
  pairId: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  timeInForce: TimeInForce;
  price?: string; // null for market orders
  stopPrice?: string; // for stop orders
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  averagePrice?: string;
  fee: string;
  feeAsset: string;
  clientOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
  filledAt?: Date;
  cancelledAt?: Date;
}

export interface Trade {
  id: string;
  pairId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  price: string;
  quantity: string;
  buyerFee: string;
  sellerFee: string;
  buyerIsMaker: boolean;
  executedAt: Date;
}

// ============================================
// P2P Types
// ============================================
export enum P2PAdType {
  BUY = 'buy',
  SELL = 'sell',
}

export enum P2PPriceType {
  FIXED = 'fixed',
  FLOATING = 'floating',
}

export enum P2PAdStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum P2POrderStatus {
  PAYMENT_PENDING = 'payment_pending',
  PAYMENT_CONFIRMED = 'payment_confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DISPUTED = 'disputed',
  EXPIRED = 'expired',
}

export enum PaymentMethodType {
  BANK_TRANSFER = 'bank_transfer',
  UPI = 'upi',
  PAYTM = 'paytm',
  PHONEPE = 'phonepe',
  GPAY = 'gpay',
  IMPS = 'imps',
  NEFT = 'neft',
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: PaymentMethodType;
  name: string;
  details: Record<string, string>; // Encrypted sensitive fields
  isActive: boolean;
  createdAt: Date;
}

export interface P2PAd {
  id: string;
  userId: string;
  type: P2PAdType;
  tokenId: string;
  fiatCurrency: string;
  priceType: P2PPriceType;
  price: string;
  floatingPriceMargin?: string; // Percentage above/below market
  minAmount: string;
  maxAmount: string;
  availableAmount: string;
  totalAmount: string;
  paymentMethods: string[]; // PaymentMethod IDs
  paymentTimeLimit: number; // In minutes
  remarks?: string;
  autoReply?: string;
  countries?: string[]; // ISO country codes for geo-filtering
  status: P2PAdStatus;
  completedOrders: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface P2POrder {
  id: string;
  adId: string;
  buyerId: string;
  sellerId: string;
  tokenId: string;
  fiatCurrency: string;
  price: string;
  quantity: string;
  fiatAmount: string;
  paymentMethodId: string;
  status: P2POrderStatus;
  escrowId: string;
  paymentConfirmedAt?: Date;
  releasedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Escrow {
  id: string;
  p2pOrderId: string;
  userId: string; // Seller
  tokenId: string;
  amount: string;
  status: 'locked' | 'released' | 'refunded';
  lockedAt: Date;
  releasedAt?: Date;
  refundedAt?: Date;
}

export interface P2PDispute {
  id: string;
  orderId: string;
  initiatorId: string;
  reason: string;
  evidence: string[]; // URLs to uploaded evidence
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolution?: 'favor_buyer' | 'favor_seller' | 'cancelled';
  adminId?: string;
  adminNotes?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Transaction Types
// ============================================
export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRADE = 'trade',
  FEE = 'fee',
  P2P_ESCROW_LOCK = 'p2p_escrow_lock',
  P2P_ESCROW_RELEASE = 'p2p_escrow_release',
  P2P_ESCROW_REFUND = 'p2p_escrow_refund',
  REFERRAL_REWARD = 'referral_reward',
  AIRDROP = 'airdrop',
  ADJUSTMENT = 'adjustment',
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Transaction {
  id: string;
  userId: string;
  tokenId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  fee?: string;
  txHash?: string;
  chainId?: ChainId;
  fromAddress?: string;
  toAddress?: string;
  confirmations: number;
  requiredConfirmations: number;
  memo?: string;
  referenceId?: string; // Links to order, trade, etc.
  referenceType?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================
// Audit Log Types
// ============================================
export enum AuditAction {
  // Auth
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_CHANGE = 'password_change',
  TWO_FACTOR_ENABLED = 'two_factor_enabled',
  TWO_FACTOR_DISABLED = 'two_factor_disabled',
  
  // KYC
  KYC_SUBMITTED = 'kyc_submitted',
  KYC_APPROVED = 'kyc_approved',
  KYC_REJECTED = 'kyc_rejected',
  
  // Wallet
  WALLET_CREATED = 'wallet_created',
  DEPOSIT_INITIATED = 'deposit_initiated',
  WITHDRAWAL_INITIATED = 'withdrawal_initiated',
  WITHDRAWAL_APPROVED = 'withdrawal_approved',
  WITHDRAWAL_REJECTED = 'withdrawal_rejected',
  
  // Trading
  ORDER_PLACED = 'order_placed',
  ORDER_CANCELLED = 'order_cancelled',
  TRADE_EXECUTED = 'trade_executed',
  
  // P2P
  P2P_AD_CREATED = 'p2p_ad_created',
  P2P_AD_UPDATED = 'p2p_ad_updated',
  P2P_ORDER_CREATED = 'p2p_order_created',
  P2P_PAYMENT_CONFIRMED = 'p2p_payment_confirmed',
  P2P_SELLER_VERIFIED_PAYMENT = 'p2p_seller_verified_payment',
  P2P_ORDER_CANCELLED = 'p2p_order_cancelled',
  P2P_ORDER_RELEASED = 'p2p_order_released',
  P2P_DISPUTE_OPENED = 'p2p_dispute_opened',
  P2P_DISPUTE_RESOLVED = 'p2p_dispute_resolved',
  
  // Admin
  ADMIN_USER_SUSPENDED = 'admin_user_suspended',
  ADMIN_USER_ACTIVATED = 'admin_user_activated',
  ADMIN_WITHDRAWAL_APPROVED = 'admin_withdrawal_approved',
  ADMIN_WITHDRAWAL_REJECTED = 'admin_withdrawal_rejected',
  ADMIN_SETTINGS_CHANGED = 'admin_settings_changed',
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  ipAddress: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================
// API Response Types
// ============================================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================
// WebSocket Types
// ============================================
export enum WSEventType {
  // Public channels
  ORDERBOOK_UPDATE = 'orderbook_update',
  ORDERBOOK_SNAPSHOT = 'orderbook_snapshot',
  TRADE = 'trade',
  TICKER = 'ticker',
  KLINE = 'kline',
  
  // Private channels
  ORDER_UPDATE = 'order_update',
  BALANCE_UPDATE = 'balance_update',
  P2P_ORDER_UPDATE = 'p2p_order_update',
  NOTIFICATION = 'notification',
}

export interface WSMessage<T = unknown> {
  type: WSEventType;
  channel: string;
  data: T;
  timestamp: number;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface OrderbookSnapshot {
  pair: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId: number;
  timestamp: number;
}

export interface Ticker {
  pair: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  high: string;
  low: string;
  volume: string;
  quoteVolume: string;
  openPrice: string;
  closePrice: string;
  timestamp: number;
}
