'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseInfiniteScrollOptions<T> {
  fetchFn: (params: { limit: number; offset: number }) => Promise<{ data: T[]; total: number; hasMore: boolean }>;
  limit?: number;
  dependencies?: any[];
}

interface UseInfiniteScrollReturn<T> {
  data: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  total: number;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
  setData: React.Dispatch<React.SetStateAction<T[]>>;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useInfiniteScroll<T>({
  fetchFn,
  limit = 20,
  dependencies = [],
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Initial fetch
  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn({ limit, offset: 0 });
      setData(result.data);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setOffset(result.data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [fetchFn, limit]);

  // Load more
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    
    loadingRef.current = true;
    setLoadingMore(true);
    
    try {
      const result = await fetchFn({ limit, offset });
      setData(prev => [...prev, ...result.data]);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setOffset(prev => prev + result.data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, [fetchFn, limit, offset, hasMore]);

  // Refresh (reset and fetch)
  const refresh = useCallback(() => {
    setOffset(0);
    setData([]);
    setHasMore(true);
    fetchInitial();
  }, [fetchInitial]);

  // Initial load
  useEffect(() => {
    fetchInitial();
  }, [...dependencies]);

  // Infinite scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Load more when user scrolls near bottom (100px threshold)
      if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !loadingRef.current) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore, hasMore]);

  return {
    data,
    loading,
    loadingMore,
    hasMore,
    total,
    error,
    loadMore,
    refresh,
    setData,
    containerRef,
  };
}

// Hook for window-based infinite scroll (for full-page tables)
export function useWindowInfiniteScroll<T>({
  fetchFn,
  limit = 20,
  dependencies = [],
}: UseInfiniteScrollOptions<T>): Omit<UseInfiniteScrollReturn<T>, 'containerRef'> & { sentinelRef: React.RefObject<HTMLDivElement> } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Initial fetch
  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn({ limit, offset: 0 });
      setData(result.data);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setOffset(result.data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [fetchFn, limit]);

  // Load more
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    
    loadingRef.current = true;
    setLoadingMore(true);
    
    try {
      const result = await fetchFn({ limit, offset });
      setData(prev => [...prev, ...result.data]);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setOffset(prev => prev + result.data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, [fetchFn, limit, offset, hasMore]);

  // Refresh
  const refresh = useCallback(() => {
    setOffset(0);
    setData([]);
    setHasMore(true);
    fetchInitial();
  }, [fetchInitial]);

  // Initial load
  useEffect(() => {
    fetchInitial();
  }, [...dependencies]);

  // Intersection Observer for sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  return {
    data,
    loading,
    loadingMore,
    hasMore,
    total,
    error,
    loadMore,
    refresh,
    setData,
    sentinelRef,
  };
}
