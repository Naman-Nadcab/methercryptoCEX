use crate::types::{MatchEvent, Order, Price, Quantity, Side};
use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::cmp::min;
use uuid::Uuid;

/// Internal key: price (None = market, lowest priority), created_at, order_id. Not exposed in API.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OrderKey {
    price: Option<Price>,
    created_at: u64,
    order_id: Uuid,
}

impl OrderKey {
    fn from_order(o: &Order) -> Self {
        OrderKey {
            price: o.price.clone(),
            created_at: o.created_at,
            order_id: o.id,
        }
    }
}

/// Key for bid book: higher price first, then earlier created_at. None price = lowest priority.
#[derive(Debug, Clone, PartialEq, Eq)]
struct BidKey {
    price_key: Option<Reverse<Price>>,
    created_at: u64,
    order_id: Uuid,
}

impl PartialOrd for BidKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for BidKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        match (&self.price_key, &other.price_key) {
            (None, None) => self.created_at.cmp(&other.created_at).then_with(|| self.order_id.cmp(&other.order_id)),
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => a
                .cmp(b)
                .then_with(|| self.created_at.cmp(&other.created_at))
                .then_with(|| self.order_id.cmp(&other.order_id)),
        }
    }
}

impl From<&OrderKey> for BidKey {
    fn from(k: &OrderKey) -> Self {
        BidKey {
            price_key: k.price.as_ref().map(|p| Reverse(p.clone())),
            created_at: k.created_at,
            order_id: k.order_id,
        }
    }
}

/// Key for ask book: lower price first, then earlier created_at. None price = lowest priority.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AskKey {
    price_key: Option<Price>,
    created_at: u64,
    order_id: Uuid,
}

impl PartialOrd for AskKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AskKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        match (&self.price_key, &other.price_key) {
            (None, None) => self.created_at.cmp(&other.created_at).then_with(|| self.order_id.cmp(&other.order_id)),
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => a
                .cmp(b)
                .then_with(|| self.created_at.cmp(&other.created_at))
                .then_with(|| self.order_id.cmp(&other.order_id)),
        }
    }
}

impl From<&OrderKey> for AskKey {
    fn from(k: &OrderKey) -> Self {
        AskKey {
            price_key: k.price.clone(),
            created_at: k.created_at,
            order_id: k.order_id,
        }
    }
}

/// In-memory order book per market. No matching logic.
#[derive(Debug, Clone, Default)]
pub struct OrderBook {
    bids: BTreeMap<BidKey, Order>,
    asks: BTreeMap<AskKey, Order>,
}

/// Snapshot of bids and asks as Vec<Order> only. No internal keys exposed. Priority order.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OrderBookSnapshot {
    pub bids: Vec<Order>,
    pub asks: Vec<Order>,
}

impl OrderBook {
    pub fn new() -> Self {
        Self {
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }
    }

    /// Insert order into the correct side. No matching. Deterministic price–time priority.
    pub fn insert(&mut self, order: Order) {
        let ok = OrderKey::from_order(&order);
        match order.side {
            Side::Buy => {
                let key = BidKey::from(&ok);
                self.bids.insert(key, order);
            }
            Side::Sell => {
                let key = AskKey::from(&ok);
                self.asks.insert(key, order);
            }
        }
    }

    /// Returns snapshot as bids and asks Vec<Order> in priority order. No internal keys exposed.
    pub fn snapshot(&self) -> OrderBookSnapshot {
        OrderBookSnapshot {
            bids: self.bids.values().cloned().collect(),
            asks: self.asks.values().cloned().collect(),
        }
    }

    /// Match best bid vs best ask while bid price >= ask price. Incoming order is the taker.
    pub fn match_orders(&mut self, market: &str, incoming_order_id: Uuid) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        loop {
            let (best_bid_key, best_ask_key) = match (self.bids.first_key_value(), self.asks.first_key_value()) {
                (Some(b), Some(a)) => (b.0.clone(), a.0.clone()),
                _ => break,
            };
            let bid_price = match self.bids.get(&best_bid_key).and_then(|o| o.price.clone()) {
                Some(p) => p,
                None => break,
            };
            let ask_price = match self.asks.get(&best_ask_key).and_then(|o| o.price.clone()) {
                Some(p) => p,
                None => break,
            };
            if bid_price < ask_price {
                break;
            }
            let mut bid_order = match self.bids.remove(&best_bid_key) {
                Some(o) => o,
                None => break,
            };
            let mut ask_order = match self.asks.remove(&best_ask_key) {
                Some(o) => o,
                None => {
                    self.bids.insert(best_bid_key, bid_order);
                    break;
                }
            };
            let matched_qty: Quantity = min(bid_order.remaining.clone(), ask_order.remaining.clone());
            if matched_qty.is_zero() {
                self.bids.insert(best_bid_key, bid_order);
                self.asks.insert(best_ask_key, ask_order);
                break;
            }
            let q = matched_qty.clone();
            bid_order.remaining = bid_order.remaining - q.clone();
            ask_order.remaining = ask_order.remaining - matched_qty.clone();
            let (taker_order_id, maker_order_id, taker_user_id, maker_user_id, taker_side) =
                if bid_order.id == incoming_order_id {
                    (bid_order.id, ask_order.id, bid_order.user_id, ask_order.user_id, Side::Buy)
                } else {
                    (ask_order.id, bid_order.id, ask_order.user_id, bid_order.user_id, Side::Sell)
                };
            events.push(MatchEvent {
                market: market.to_string(),
                bid_order_id: bid_order.id,
                ask_order_id: ask_order.id,
                bid_user_id: bid_order.user_id,
                ask_user_id: ask_order.user_id,
                taker_order_id,
                maker_order_id,
                taker_user_id,
                maker_user_id,
                taker_side,
                price: ask_price,
                quantity: matched_qty,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            });
            if !bid_order.remaining.is_zero() {
                self.bids.insert(best_bid_key, bid_order);
            }
            if !ask_order.remaining.is_zero() {
                self.asks.insert(best_ask_key, ask_order);
            }
        }
        events
    }

    /// Remove an order by id from the book (bids or asks).
    pub fn cancel_order(&mut self, order_id: Uuid) {
        self.bids.retain(|_, o| o.id != order_id);
        self.asks.retain(|_, o| o.id != order_id);
    }

    /// Apply a single match fill (reduce remaining on bid/ask). Used for WAL replay alignment.
    /// Strict: both orders must exist, same market, and each `remaining >= ev.quantity`.
    pub fn apply_match_fill(&mut self, ev: &MatchEvent) -> Result<(), String> {
        use rust_decimal::Decimal;
        if ev.quantity <= Decimal::ZERO {
            return Err("apply_match_fill: non-positive quantity".into());
        }

        let bid_key = self
            .bids
            .iter()
            .find(|(_, o)| o.id == ev.bid_order_id)
            .map(|(k, _)| k.clone());
        let ask_key = self
            .asks
            .iter()
            .find(|(_, o)| o.id == ev.ask_order_id)
            .map(|(k, _)| k.clone());

        let (bk, ak) = match (bid_key, ask_key) {
            (Some(b), Some(a)) => (b, a),
            (b, a) => {
                return Err(format!(
                    "apply_match_fill: missing order bid_key={} ask_key={} (bid_order_id={} ask_order_id={})",
                    b.is_some(),
                    a.is_some(),
                    ev.bid_order_id,
                    ev.ask_order_id
                ));
            }
        };

        let mut bid = self.bids.remove(&bk).ok_or_else(|| "apply_match_fill: bid remove".to_string())?;
        let mut ask = self.asks.remove(&ak).ok_or_else(|| "apply_match_fill: ask remove".to_string())?;

        if bid.market != ev.market || ask.market != ev.market {
            let bm = bid.market.clone();
            let am = ask.market.clone();
            self.bids.insert(bk, bid);
            self.asks.insert(ak, ask);
            return Err(format!(
                "apply_match_fill: market mismatch (ev={} bid={} ask={})",
                ev.market, bm, am
            ));
        }

        if bid.remaining < ev.quantity || ask.remaining < ev.quantity {
            let br = bid.remaining;
            let ar = ask.remaining;
            self.bids.insert(bk, bid);
            self.asks.insert(ak, ask);
            return Err(format!(
                "apply_match_fill: insufficient remaining bid_rem={br} ask_rem={ar} need={}",
                ev.quantity
            ));
        }

        bid.remaining -= ev.quantity;
        ask.remaining -= ev.quantity;

        if !bid.remaining.is_zero() {
            self.bids.insert(bk, bid);
        }
        if !ask.remaining.is_zero() {
            self.asks.insert(ak, ask);
        }
        Ok(())
    }
}
