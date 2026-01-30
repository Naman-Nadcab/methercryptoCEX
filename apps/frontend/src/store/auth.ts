import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface User {
  id: string;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  role?: 'user' | 'admin' | 'super_admin';
  status: 'pending' | 'active' | 'suspended' | 'banned' | 'deleted';
  accountType?: 'individual' | 'corporate' | 'institutional';
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFaEnabled?: boolean;
  tierLevel: number;
  countryCode?: string | null;
  timezone?: string;
  language?: string;
  referralCode?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateUser: (updates: Partial<User>) => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      _hasHydrated: false,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),

      login: (user, accessToken, refreshToken) => set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
      }),

      logout: () => set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
      }),

      setLoading: (isLoading) => set({ isLoading }),

      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null,
      })),
      
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Called when rehydration is complete
        state?.setHasHydrated(true);
      },
    }
  )
);

// Trading store
interface TradingState {
  selectedPair: string;
  orderbook: {
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
  };
  recentTrades: Array<{
    id: string;
    price: string;
    quantity: string;
    side: 'buy' | 'sell';
    timestamp: number;
  }>;
  ticker: {
    lastPrice: string;
    priceChange: string;
    priceChangePercent: string;
    high: string;
    low: string;
    volume: string;
  } | null;
  
  // Actions
  setSelectedPair: (pair: string) => void;
  setOrderbook: (orderbook: TradingState['orderbook']) => void;
  setRecentTrades: (trades: TradingState['recentTrades']) => void;
  setTicker: (ticker: TradingState['ticker']) => void;
  updateOrderbook: (side: 'bids' | 'asks', updates: Array<{ price: string; quantity: string }>) => void;
  addTrade: (trade: TradingState['recentTrades'][0]) => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  selectedPair: 'BTC_USDT',
  orderbook: { bids: [], asks: [] },
  recentTrades: [],
  ticker: null,

  setSelectedPair: (selectedPair) => set({ selectedPair }),

  setOrderbook: (orderbook) => set({ orderbook }),

  setRecentTrades: (recentTrades) => set({ recentTrades }),

  setTicker: (ticker) => set({ ticker }),

  updateOrderbook: (side, updates) => set((state) => {
    const newOrderbook = { ...state.orderbook };
    const existing = new Map(newOrderbook[side].map((l) => [l.price, l]));
    
    for (const update of updates) {
      if (parseFloat(update.quantity) === 0) {
        existing.delete(update.price);
      } else {
        existing.set(update.price, update);
      }
    }
    
    newOrderbook[side] = Array.from(existing.values());
    
    // Sort: bids descending, asks ascending
    if (side === 'bids') {
      newOrderbook[side].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } else {
      newOrderbook[side].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    }
    
    return { orderbook: newOrderbook };
  }),

  addTrade: (trade) => set((state) => ({
    recentTrades: [trade, ...state.recentTrades.slice(0, 99)],
  })),
}));

// Wallet store
interface Balance {
  tokenId: string;
  symbol: string;
  name: string;
  available: string;
  locked: string;
  chainId: string;
}

interface WalletState {
  balances: Balance[];
  wallets: Array<{
    chainId: string;
    address: string;
  }>;
  isLoading: boolean;
  
  setBalances: (balances: Balance[]) => void;
  setWallets: (wallets: WalletState['wallets']) => void;
  updateBalance: (tokenId: string, available: string, locked: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balances: [],
  wallets: [],
  isLoading: true,

  setBalances: (balances) => set({ balances, isLoading: false }),

  setWallets: (wallets) => set({ wallets }),

  updateBalance: (tokenId, available, locked) => set((state) => ({
    balances: state.balances.map((b) =>
      b.tokenId === tokenId ? { ...b, available, locked } : b
    ),
  })),

  setLoading: (isLoading) => set({ isLoading }),
}));
