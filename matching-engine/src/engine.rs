use crate::orderbook::{OrderBook, OrderBookSnapshot};
use crate::types::{MatchEvent, Order, OrderId, Market};
use parking_lot::RwLock;
use std::collections::HashMap;

pub const MAX_EVENTS: usize = 10_000;

pub struct Engine {
    order_books: RwLock<HashMap<Market, OrderBook>>,
    match_events: RwLock<Vec<MatchEvent>>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            order_books: RwLock::new(HashMap::new()),
            match_events: RwLock::new(Vec::new()),
        }
    }

    /// Place an order: insert, run dry-run matching, store events in memory.
    pub fn place_order(&self, order: Order) -> Result<(), String> {
        let market = order.market.clone();
        let mut books = self.order_books.write();
        let book = books.entry(market.clone()).or_insert_with(OrderBook::new);
        book.insert(order);
        let events = book.match_orders(&market);
        let mut ev = self.match_events.write();
        ev.extend(events);
        if ev.len() > MAX_EVENTS {
            ev.drain(0..ev.len() - MAX_EVENTS);
        }
        Ok(())
    }

    /// Read-only: return events from since_index onward and next_index. Does not remove or mutate.
    pub fn get_match_events(&self, since_index: usize) -> (Vec<MatchEvent>, usize) {
        let ev = self.match_events.read();
        let len = ev.len();
        let start = since_index.min(len);
        let slice = ev.get(start..).unwrap_or_default();
        (slice.to_vec(), len)
    }

    /// Cancel an order by id. Stub: no side effects.
    pub fn cancel_order(&self, _order_id: OrderId) -> Result<(), String> {
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
