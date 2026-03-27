use crate::orderbook::{OrderBook, OrderBookSnapshot};
use crate::types::{MatchEvent, Order, OrderId, Market};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_EVENTS: usize = 10_000;

pub struct Engine {
    order_books: RwLock<HashMap<Market, OrderBook>>,
    match_events: RwLock<Vec<(usize, MatchEvent)>>,
    /// Next event id to assign. Restored from backend on rebuild so we never reuse settled ids.
    next_event_id: AtomicUsize,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            order_books: RwLock::new(HashMap::new()),
            match_events: RwLock::new(Vec::new()),
            next_event_id: AtomicUsize::new(1),
        }
    }

    /// Restore orderbook from backend state (no matching). Sets next_event_id so new matches get correct ids.
    pub fn restore_orderbook(&self, orders: Vec<Order>, last_engine_event_id: usize) {
        let mut books = self.order_books.write();
        books.clear();
        for order in orders {
            let market = order.market.clone();
            let book = books.entry(market).or_insert_with(OrderBook::new);
            book.insert(order);
        }
        self.next_event_id.store(last_engine_event_id.saturating_add(1), Ordering::SeqCst);
    }

    /// Place an order: insert, run matching, store events in memory.
    pub fn place_order(&self, order: Order) -> Result<(), String> {
        let market = order.market.clone();
        let mut books = self.order_books.write();
        let book = books.entry(market.clone()).or_insert_with(OrderBook::new);
        book.insert(order.clone());
        let events = book.match_orders(&market, order.id);
        let n = events.len();
        let start = if n > 0 {
            self.next_event_id.fetch_add(n, Ordering::SeqCst)
        } else {
            0
        };
        let mut ev = self.match_events.write();
        for (i, e) in events.into_iter().enumerate() {
            ev.push((start + i, e));
        }
        let to_remove = ev.len().saturating_sub(MAX_EVENTS);
        if to_remove > 0 {
            ev.drain(0..to_remove);
        }
        Ok(())
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

    /// Cancel an order by id. Removes from orderbook (both sides).
    pub fn cancel_order(&self, order_id: OrderId) -> Result<(), String> {
        let mut books = self.order_books.write();
        for book in books.values_mut() {
            book.cancel_order(order_id);
        }
        Ok(())
    }

    /// Snapshot of order books. Bids/asks in priority order.
    pub fn snapshot(&self, market: Option<&str>) -> HashMap<String, OrderBookSnapshot> {
        let books = self.order_books.read();
        if let Some(m) = market {
            books
                .get(m)
                .map(|ob| (m.to_string(), ob.snapshot()))
                .into_iter()
                .collect()
        } else {
            books
                .iter()
                .map(|(k, v)| (k.clone(), v.snapshot()))
                .collect()
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
