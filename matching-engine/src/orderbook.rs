use crate::types::{MatchEvent, Order, Price, Quantity, Side};
use rust_decimal::Decimal;
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

    fn remove_order_by_id(&mut self, order_id: Uuid) -> Option<Order> {
        if let Some((k, _)) = self.bids.iter().find(|(_, o)| o.id == order_id).map(|(k, o)| (k.clone(), o.clone())) {
            return self.bids.remove(&k);
        }
        if let Some((k, _)) = self.asks.iter().find(|(_, o)| o.id == order_id).map(|(k, o)| (k.clone(), o.clone())) {
            return self.asks.remove(&k);
        }
        None
    }

    fn ts_now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Limit/market buy crosses passive ask at `ask.price` (maker); market on either side uses the other leg's price.
    fn price_buy_crosses(incoming: &Order, ask: &Order) -> bool {
        match (&incoming.price, &ask.price) {
            (None, _) => true,
            (Some(_), None) => true,
            (Some(bp), Some(ap)) => bp >= ap,
        }
    }

    fn price_sell_crosses(incoming: &Order, bid: &Order) -> bool {
        match (&incoming.price, &bid.price) {
            (None, _) => true,
            (Some(_), None) => true,
            (Some(sp), Some(bp)) => sp <= bp,
        }
    }

    /// Match `incoming_order_id` against the opposite book only (incoming is always taker).
    /// Skips passive quotes from the same user so we never emit self-trade fills Node would reject.
    pub fn match_orders(&mut self, market: &str, incoming_order_id: Uuid) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let Some(mut incoming) = self.remove_order_by_id(incoming_order_id) else {
            return events;
        };

        match incoming.side {
            Side::Buy => {
                while incoming.remaining > Decimal::ZERO {
                    let candidate = self
                        .asks
                        .iter()
                        .find(|(_, o)| {
                            o.user_id != incoming.user_id && Self::price_buy_crosses(&incoming, o)
                        })
                        .map(|(k, o)| (k.clone(), o.clone()));

                    let Some((ask_key, mut ask_order)) = candidate else {
                        break;
                    };

                    let matched_qty: Quantity = min(incoming.remaining.clone(), ask_order.remaining.clone());
                    if matched_qty.is_zero() {
                        break;
                    }

                    let exec_price = ask_order
                        .price
                        .clone()
                        .or_else(|| incoming.price.clone())
                        .unwrap_or_else(|| Decimal::ZERO);

                    incoming.remaining = incoming.remaining - matched_qty.clone();
                    ask_order.remaining = ask_order.remaining - matched_qty.clone();

                    events.push(MatchEvent {
                        market: market.to_string(),
                        bid_order_id: incoming.id,
                        ask_order_id: ask_order.id,
                        bid_user_id: incoming.user_id,
                        ask_user_id: ask_order.user_id,
                        taker_order_id: incoming.id,
                        maker_order_id: ask_order.id,
                        taker_user_id: incoming.user_id,
                        maker_user_id: ask_order.user_id,
                        taker_side: Side::Buy,
                        price: exec_price,
                        quantity: matched_qty,
                        timestamp: Self::ts_now_ms(),
                    });

                    self.asks.remove(&ask_key);
                    if ask_order.remaining > Decimal::ZERO {
                        self.asks.insert(ask_key, ask_order);
                    }
                }
            }
            Side::Sell => {
                while incoming.remaining > Decimal::ZERO {
                    let candidate = self
                        .bids
                        .iter()
                        .find(|(_, o)| {
                            o.user_id != incoming.user_id && Self::price_sell_crosses(&incoming, o)
                        })
                        .map(|(k, o)| (k.clone(), o.clone()));

                    let Some((bid_key, mut bid_order)) = candidate else {
                        break;
                    };

                    let matched_qty: Quantity = min(incoming.remaining.clone(), bid_order.remaining.clone());
                    if matched_qty.is_zero() {
                        break;
                    }

                    let exec_price = bid_order
                        .price
                        .clone()
                        .or_else(|| incoming.price.clone())
                        .unwrap_or_else(|| Decimal::ZERO);

                    incoming.remaining = incoming.remaining - matched_qty.clone();
                    bid_order.remaining = bid_order.remaining - matched_qty.clone();

                    events.push(MatchEvent {
                        market: market.to_string(),
                        bid_order_id: bid_order.id,
                        ask_order_id: incoming.id,
                        bid_user_id: bid_order.user_id,
                        ask_user_id: incoming.user_id,
                        taker_order_id: incoming.id,
                        maker_order_id: bid_order.id,
                        taker_user_id: incoming.user_id,
                        maker_user_id: bid_order.user_id,
                        taker_side: Side::Sell,
                        price: exec_price,
                        quantity: matched_qty,
                        timestamp: Self::ts_now_ms(),
                    });

                    self.bids.remove(&bid_key);
                    if bid_order.remaining > Decimal::ZERO {
                        self.bids.insert(bid_key, bid_order);
                    }
                }
            }
        }

        if incoming.remaining > Decimal::ZERO {
            self.insert(incoming);
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

#[cfg(test)]
mod match_tests {
    use super::OrderBook;
    use crate::types::{Order, OrderType, Side};
    use uuid::Uuid;

    fn mk_order(id: Uuid, uid: Uuid, side: Side, price: &str, qty: &str) -> Order {
        let q: rust_decimal::Decimal = qty.parse().unwrap();
        Order {
            id,
            user_id: uid,
            market: "BTC_USDT".into(),
            side,
            order_type: OrderType::Limit,
            price: Some(price.parse().unwrap()),
            quantity: q,
            remaining: q,
            created_at: 1,
        }
    }

    #[test]
    fn incoming_limit_buy_crosses_resting_limit_sell_two_users() {
        let mut book = OrderBook::new();
        let uid_a = Uuid::parse_str("41b10518-e444-4692-a802-a511c694719c").unwrap();
        let uid_b = Uuid::parse_str("0223ce80-1918-433f-92bc-5d56a4c75009").unwrap();
        let oid_sell = Uuid::new_v4();
        let oid_buy = Uuid::new_v4();
        book.insert(mk_order(oid_sell, uid_a, Side::Sell, "876543.21", "0.0001"));
        book.insert(mk_order(oid_buy, uid_b, Side::Buy, "876543.21", "0.0001"));
        let ev = book.match_orders("BTC_USDT", oid_buy);
        assert_eq!(ev.len(), 1, "expected one match event");
        assert!(book.bids.is_empty() && book.asks.is_empty(), "both fully filled");
    }
}
