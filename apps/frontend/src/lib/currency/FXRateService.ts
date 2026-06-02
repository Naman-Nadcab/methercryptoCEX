'use client';

import { api } from '@/lib/api';
import { DEFAULT_USDT_INR_RATE } from './CurrencyConversionUtility';

type FxCacheRecord = { rate: number; updatedAtMs: number };

const FX_CACHE_TTL_MS = 45_000;
const FX_STORAGE_KEY = 'display_fx_usdt_inr';
let inMemoryCache: FxCacheRecord | null = null;

function readLocalFxCache(): FxCacheRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FxCacheRecord;
    if (!Number.isFinite(parsed?.rate) || parsed.rate <= 0 || !Number.isFinite(parsed?.updatedAtMs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalFxCache(record: FxCacheRecord): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore quota/private mode errors
  }
}

function isFresh(record: FxCacheRecord | null): boolean {
  if (!record) return false;
  return Date.now() - record.updatedAtMs <= FX_CACHE_TTL_MS;
}

export class FXRateService {
  static async getUsdtInrRate(forceRefresh = false): Promise<number> {
    if (!forceRefresh && isFresh(inMemoryCache)) return inMemoryCache!.rate;
    if (!forceRefresh) {
      const local = readLocalFxCache();
      if (isFresh(local)) {
        inMemoryCache = local;
        return local.rate;
      }
    }

    try {
      const res = await api.get<{
        asset?: string;
        fiat?: string;
        reference_price?: string;
        updated_at?: string;
      }>('/api/v1/p2p/reference-price?asset=USDT&fiat=INR', { skipAuth: true, notifyOnError: false });
      const parsed = Number(res.data?.reference_price);
      if (res.success && Number.isFinite(parsed) && parsed > 0) {
        const record: FxCacheRecord = { rate: parsed, updatedAtMs: Date.now() };
        inMemoryCache = record;
        writeLocalFxCache(record);
        return parsed;
      }
    } catch {
      // handled by safe fallback below
    }

    const fallback = readLocalFxCache();
    if (fallback) {
      inMemoryCache = fallback;
      return fallback.rate;
    }
    return DEFAULT_USDT_INR_RATE;
  }
}
