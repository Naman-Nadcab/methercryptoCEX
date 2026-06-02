'use client';

import { api } from '@/lib/api';
import { DisplayCurrency, normalizeDisplayCurrency } from './CurrencyConversionUtility';

const DISPLAY_PREF_STORAGE_KEY = 'display_currency_preference';

export class CurrencyPreferenceService {
  static readLocalPreference(): DisplayCurrency {
    if (typeof window === 'undefined') return 'USDT';
    try {
      return normalizeDisplayCurrency(window.localStorage.getItem(DISPLAY_PREF_STORAGE_KEY));
    } catch {
      return 'USDT';
    }
  }

  static writeLocalPreference(currency: DisplayCurrency): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DISPLAY_PREF_STORAGE_KEY, currency);
    } catch {
      // ignore localStorage write errors
    }
  }

  static async fetchRemotePreference(): Promise<DisplayCurrency | null> {
    try {
      const res = await api.get<Record<string, unknown>>('/api/v1/auth/preferences', { notifyOnError: false });
      if (!res.success || !res.data) return null;
      return normalizeDisplayCurrency(res.data.displayCurrency ?? res.data.equivalentCurrency);
    } catch {
      return null;
    }
  }

  static async saveRemotePreference(currency: DisplayCurrency): Promise<void> {
    try {
      // Keep both keys in sync for backward compatibility.
      await api.post('/api/v1/auth/preferences', { displayCurrency: currency, equivalentCurrency: currency }, { notifyOnError: false });
    } catch {
      // local preference still keeps UI functional when network fails
    }
  }
}
