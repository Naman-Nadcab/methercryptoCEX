'use client';

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'spot_favorites';

function getStored(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(favorites: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // ignore
  }
}

export function useSpotFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(getStored());
  }, []);

  const toggle = useCallback((symbol: string) => {
    setFavorites((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
      save(next);
      return next;
    });
  }, []);

  const sortWithFavoritesFirst = useCallback(
    <T extends { symbol: string }>(markets: T[]): T[] => {
      if (favorites.length === 0) return markets;
      const favSet = new Set(favorites);
      return [...markets].sort((a, b) => {
        const aFav = favSet.has(a.symbol);
        const bFav = favSet.has(b.symbol);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return 0;
      });
    },
    [favorites]
  );

  return { favorites, isFavorite: (s: string) => favorites.includes(s), toggle, sortWithFavoritesFirst };
}
