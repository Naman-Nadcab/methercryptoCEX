'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { CurrencyPreferenceService } from '@/lib/currency/CurrencyPreferenceService';
import { FXRateService } from '@/lib/currency/FXRateService';
import {
  DisplayCurrency,
  convertUsdtToDisplay,
  formatDisplayCurrency,
  formatSecondaryDisplayFromUsdt,
  normalizeDisplayCurrency,
} from '@/lib/currency/CurrencyConversionUtility';

type DisplayCurrencyContextValue = {
  displayCurrency: DisplayCurrency;
  usdtInrRate: number;
  setDisplayCurrency: (next: DisplayCurrency) => void;
  formatFromUsdt: (amountUsdt: number, maxUsdtDecimals?: number) => string;
  formatSecondaryFromUsdt: (amountUsdt: number, maxUsdtDecimals?: number) => string | null;
  convertFromUsdt: (amountUsdt: number) => number;
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);
const FX_REFRESH_MS = 45_000;

export function DisplayCurrencyProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, _hasHydrated } = useAuthStore();
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>('USDT');
  const [usdtInrRate, setUsdtInrRate] = useState<number>(83);

  useEffect(() => {
    setDisplayCurrencyState(CurrencyPreferenceService.readLocalPreference());
  }, []);

  useEffect(() => {
    if (!_hasHydrated) return;
    let cancelled = false;
    (async () => {
      const pref = accessToken ? await CurrencyPreferenceService.fetchRemotePreference() : null;
      if (cancelled) return;
      if (pref) {
        setDisplayCurrencyState(pref);
        CurrencyPreferenceService.writeLocalPreference(pref);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, accessToken]);

  useEffect(() => {
    let cancelled = false;
    const refreshFx = async () => {
      const rate = await FXRateService.getUsdtInrRate(false);
      if (!cancelled) setUsdtInrRate(rate);
    };
    void refreshFx();
    const id = window.setInterval(() => {
      void refreshFx();
    }, FX_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const setDisplayCurrency = useCallback((next: DisplayCurrency) => {
    const normalized = normalizeDisplayCurrency(next);
    setDisplayCurrencyState(normalized);
    CurrencyPreferenceService.writeLocalPreference(normalized);
    void CurrencyPreferenceService.saveRemotePreference(normalized);
  }, []);

  const value = useMemo<DisplayCurrencyContextValue>(
    () => ({
      displayCurrency,
      usdtInrRate,
      setDisplayCurrency,
      formatFromUsdt: (amountUsdt: number, maxUsdtDecimals = 8) =>
        formatDisplayCurrency(convertUsdtToDisplay(amountUsdt, displayCurrency, usdtInrRate), displayCurrency, maxUsdtDecimals),
      formatSecondaryFromUsdt: (amountUsdt: number, maxUsdtDecimals = 8) =>
        formatSecondaryDisplayFromUsdt(amountUsdt, displayCurrency, usdtInrRate, maxUsdtDecimals),
      convertFromUsdt: (amountUsdt: number) => convertUsdtToDisplay(amountUsdt, displayCurrency, usdtInrRate),
    }),
    [displayCurrency, usdtInrRate, setDisplayCurrency]
  );

  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const ctx = useContext(DisplayCurrencyContext);
  if (!ctx) {
    throw new Error('useDisplayCurrency must be used within DisplayCurrencyProvider');
  }
  return ctx;
}
