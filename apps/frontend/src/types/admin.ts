/**
 * Shared types for Tier-1 Admin Panel.
 * Aligns with existing backend API responses — no backend changes.
 */

export interface AdminDashboardStats {
  users: {
    total: number;
    newToday: number;
    active: number;
    verified: number;
  };
  kyc: {
    pending: number;
    underReview: number;
    approvedToday: number;
    rejectedToday: number;
  };
  p2p: {
    activeAds: number;
    activeOrders: number;
    openDisputes: number;
  };
  referrals?: {
    totalCodes: number;
    activeCodes: number;
  };
}

export interface AdminAnalyticsAll {
  tradingVolume?: number;
  tradeCount?: number;
  newUsers?: number;
  deposits?: { count: number; volume: number };
  withdrawals?: { count: number; volume: number };
  p2pOrders?: number;
  openAmlAlerts?: number;
}

export interface WithdrawalStats {
  pending_approval?: number;
  [key: string]: number | undefined;
}
