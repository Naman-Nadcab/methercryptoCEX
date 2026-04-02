use crate::orderbook::{OrderBook, OrderBookSnapshot};
use crate::types::{MatchEvent, Order, OrderId, Market};
use dashmap::DashMap;
use parking_lot::{Mutex, RwLock};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};

/// In-memory tail for GET /engine/matches only. **Authoritative log is Postgres `settlement_events`** (API persists inline + poller).
/// Large buffer reduces risk if poller lags; monitor memory in production.
pub const MAX_EVENTS: usize = 5_000_000;

/// Per-market `OrderBook` mutex: **BTC/USDT matching does not block ETH/USDT** (Phase 1 scaling).
/// Global `match_events` + `next_event_id` preserve monotonic event IDs in a single process.
pub struct Engine {
    order_books: DashMap<Market, Mutex<OrderBook>>,
    match_events: RwLock<Vec<(usize, MatchEvent)>>,
    /// Next event id to assign. Restored from backend on rebuild so we never reuse settled ids.
    next_event_id: AtomicUsize,
    /// Match event ids whose fills are already reflected in resting order `remaining` (live + replay).
    book_applied_match_event_ids: RwLock<HashSet<usize>>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            order_books: DashMap::new(),
            match_events: RwLock::new(Vec::new()),
            next_event_id: AtomicUsize::new(1),
            book_applied_match_event_ids: RwLock::new(HashSet::new()),
        }
    }

    pub fn next_event_id_value(&self) -> usize {
        self.next_event_id.load(Ordering::SeqCst)
    }

    /// All resting orders across markets (for persistence snapshot).
    pub fn collect_all_orders(&self) -> Vec<Order> {
        let mut v = Vec::new();
        for entry in self.order_books.iter() {
            let snap = entry.value().lock().snapshot();
            v.extend(snap.bids);
            v.extend(snap.asks);
        }
        v.sort_by(|a, b| a.market.cmp(&b.market).then_with(|| a.id.cmp(&b.id)));
        v
    }

    pub fn book_applied_match_ids_snapshot(&self) -> Vec<usize> {
        let g = self.book_applied_match_event_ids.read();
        let mut out: Vec<_> = g.iter().copied().collect();
        out.sort_unstable();
        out
    }

    fn record_book_applied_for_event_ids(&self, ids: &[usize]) {
        if ids.is_empty() {
            return;
        }
        let mut g = self.book_applied_match_event_ids.write();
        for &id in ids {
            g.insert(id);
        }
    }

    fn insert_match_event_sorted(&self, event_id: usize, ev: MatchEvent) {
        let mut w = self.match_events.write();
        match w.binary_search_by_key(&event_id, |(id, _)| *id) {
            Ok(_) => return,
            Err(i) => w.insert(i, (event_id, ev)),
        }
        let to_remove = w.len().saturating_sub(MAX_EVENTS);
        if to_remove > 0 {
            eprintln!(
                "matching-engine CRITICAL: match event ring buffer overflow, dropping {} oldest events",
                to_remove
            );
            w.drain(0..to_remove);
        }
    }

    /// Restore from on-disk snapshot: books, `next_event_id`, and ids to skip when replaying WAL into the book.
    pub fn restore_from_persistence_snapshot(
        &self,
        orders: Vec<Order>,
        next_event_id: usize,
        book_applied: HashSet<usize>,
    ) {
        self.order_books.clear();
        *self.book_applied_match_event_ids.write() = book_applied;
        self.match_events.write().clear();
        for order in orders {
            let market = order.market.clone();
            let book_mutex = self
                .order_books
                .entry(market.clone())
                .or_insert_with(|| Mutex::new(OrderBook::new()));
            book_mutex.lock().insert(order);
        }
        self.next_event_id.store(next_event_id.max(1), Ordering::SeqCst);
    }

    /// Restore orderbook from backend state (no matching). Sets next_event_id so new matches get correct ids.
    pub fn restore_orderbook(&self, orders: Vec<Order>, last_engine_event_id: usize) {
        self.book_applied_match_event_ids.write().clear();
        self.match_events.write().clear();
        self.order_books.clear();
        for order in orders {
            let market = order.market.clone();
            let book_mutex = self
                .order_books
                .entry(market.clone())
                .or_insert_with(|| Mutex::new(OrderBook::new()));
            book_mutex.lock().insert(order);
        }
        self.next_event_id
            .store(last_engine_event_id.saturating_add(1), Ordering::SeqCst);
    }

    /**
     * Apply a WAL replay match to the book (idempotent by `event_id`).
     * Call **before** publishing unacked rows so the book matches stream intent.
     */
    pub fn apply_replay_event(&self, event_id: usize, ev: &MatchEvent) -> Result<(), String> {
        if self.book_applied_match_event_ids.read().contains(&event_id) {
            return Ok(());
        }
        let market = ev.market.clone();
        let book_mutex = self
            .order_books
            .entry(market)
            .or_insert_with(|| Mutex::new(OrderBook::new()));
        let mut book = book_mutex.lock();
        book.apply_match_fill(ev)?;
        drop(book);
        self.book_applied_match_event_ids.write().insert(event_id);
        self.insert_match_event_sorted(event_id, ev.clone());
        Ok(())
    }

    /// Place an order: lock **only this market's** book, match, then append to global event buffer.
    /// Returns `(event_id, match)` pairs for optional JetStream publish (same ids as `/engine/matches`).
    pub fn place_order(&self, order: Order) -> Vec<(usize, MatchEvent)> {
        let market = order.market.clone();
        let events = {
            let book_mutex = self
                .order_books
                .entry(market.clone())
                .or_insert_with(|| Mutex::new(OrderBook::new()));
            let mut book = book_mutex.lock();
            book.insert(order.clone());
            book.match_orders(&market, order.id)
        };

        let n = events.len();
        let start = if n > 0 {
            self.next_event_id.fetch_add(n, Ordering::SeqCst)
        } else {
            0
        };
        let mut published = Vec::new();
        for (i, e) in events.into_iter().enumerate() {
            let id = start + i;
            self.insert_match_event_sorted(id, e.clone());
            published.push((id, e));
        }
        self.record_book_applied_for_event_ids(
            &published.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        );
        published
    }

    /**
     * JetStream-hardened place: hold the per-market book mutex through publish callback so no concurrent
     * mutation can interleave. If `publish` fails, the orderbook is unchanged (event ids may gap).
     */
    pub fn place_order_commit_after_publish<E>(
        &self,
        order: Order,
        mut publish: impl FnMut(&[(usize, MatchEvent)]) -> Result<(), E>,
    ) -> Result<Vec<(usize, MatchEvent)>, E> {
        let market = order.market.clone();
        let book_mutex = self
            .order_books
            .entry(market.clone())
            .or_insert_with(|| Mutex::new(OrderBook::new()));
        let mut book = book_mutex.lock();
        let mut trial = book.clone();
        trial.insert(order.clone());
        let match_events = trial.match_orders(&market, order.id);
        if match_events.is_empty() {
            *book = trial;
            return Ok(vec![]);
        }
        let n = match_events.len();
        let start = self.next_event_id.fetch_add(n, Ordering::SeqCst);
        let pairs: Vec<(usize, MatchEvent)> = match_events
            .into_iter()
            .enumerate()
            .map(|(i, e)| (start + i, e))
            .collect();
        publish(&pairs)?;
        *book = trial;
        drop(book);
        for (id, e) in &pairs {
            self.insert_match_event_sorted(*id, e.clone());
        }
        self.record_book_applied_for_event_ids(&pairs.iter().map(|(id, _)| *id).collect::<Vec<_>>());
        Ok(pairs)
    }

    /**
     * Tier-1: append-only WAL (fsync) **before** committing the orderbook so a crash never leaves a fill
     * without a durable stream intent. Caller supplies `wal_pre_commit`; then book + ring buffer update.
     * JetStream publish happens **after** this returns (async queue or sync path).
     */
    pub fn place_order_wal_then_commit_book<E>(
        &self,
        order: Order,
        wal_pre_commit: impl FnOnce(&[(usize, MatchEvent)]) -> Result<(), E>,
    ) -> Result<Vec<(usize, MatchEvent)>, E> {
        let market = order.market.clone();
        let book_mutex = self
            .order_books
            .entry(market.clone())
            .or_insert_with(|| Mutex::new(OrderBook::new()));
        let mut book = book_mutex.lock();
        let mut trial = book.clone();
        trial.insert(order.clone());
        let match_events = trial.match_orders(&market, order.id);
        if match_events.is_empty() {
            *book = trial;
            return Ok(vec![]);
        }
        let n = match_events.len();
        let start = self.next_event_id.fetch_add(n, Ordering::SeqCst);
        let pairs: Vec<(usize, MatchEvent)> = match_events
            .into_iter()
            .enumerate()
            .map(|(i, e)| (start + i, e))
            .collect();
        wal_pre_commit(&pairs)?;
        *book = trial;
        drop(book);
        for (id, e) in &pairs {
            self.insert_match_event_sorted(*id, e.clone());
        }
        self.record_book_applied_for_event_ids(&pairs.iter().map(|(id, _)| *id).collect::<Vec<_>>());
        Ok(pairs)
    }

    /// WAL → JetStream publish (sync) → commit book. Holds per-market mutex through all three (Tier-1 sync).
    pub fn place_order_wal_publish_commit_book(
        &self,
        order: Order,
        wal_pre_commit: impl FnOnce(&[(usize, MatchEvent)]) -> Result<(), String>,
        publish: impl FnOnce(&[(usize, MatchEvent)]) -> Result<(), String>,
    ) -> Result<Vec<(usize, MatchEvent)>, String> {
        let market = order.market.clone();
        let book_mutex = self
            .order_books
            .entry(market.clone())
            .or_insert_with(|| Mutex::new(OrderBook::new()));
        let mut book = book_mutex.lock();
        let mut trial = book.clone();
        trial.insert(order.clone());
        let match_events = trial.match_orders(&market, order.id);
        if match_events.is_empty() {
            *book = trial;
            return Ok(vec![]);
        }
        let n = match_events.len();
        let start = self.next_event_id.fetch_add(n, Ordering::SeqCst);
        let pairs: Vec<(usize, MatchEvent)> = match_events
            .into_iter()
            .enumerate()
            .map(|(i, e)| (start + i, e))
            .collect();
        wal_pre_commit(&pairs)?;
        publish(&pairs)?;
        *book = trial;
        drop(book);
        for (id, e) in &pairs {
            self.insert_match_event_sorted(*id, e.clone());
        }
        self.record_book_applied_for_event_ids(&pairs.iter().map(|(id, _)| *id).collect::<Vec<_>>());
        Ok(pairs)
    }

    /// Return events with event_id > after_id. Compatible with backend engine-client (after_id, last_id).
    pub fn get_match_events_after(&self, after_id: usize) -> (Vec<(usize, MatchEvent)>, usize) {
        let ev = self.match_events.read();
        let filtered: Vec<_> = ev
            .iter()
            .filter(|(id, _)| *id > after_id)
            .map(|(id, e)| (*id, e.clone()))
            .collect();
        let last_id = ev.last().map(|(id, _)| *id).unwrap_or(0);
        (filtered, last_id)
    }

    /// Cancel an order by id. Scans each market book (locks one market at a time).
    pub fn cancel_order(&self, order_id: OrderId) -> Result<(), String> {
        for entry in self.order_books.iter() {
            let mut book = entry.value().lock();
            book.cancel_order(order_id);
        }
        Ok(())
    }

    /// Snapshot of order books. Bids/asks in priority order.
    pub fn snapshot(&self, market: Option<&str>) -> HashMap<String, OrderBookSnapshot> {
        if let Some(m) = market {
            self.order_books
                .get(m)
                .map(|ob| (m.to_string(), ob.lock().snapshot()))
                .into_iter()
                .collect()
        } else {
            self.order_books
                .iter()
                .map(|e| (e.key().clone(), e.value().lock().snapshot()))
                .collect()
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
