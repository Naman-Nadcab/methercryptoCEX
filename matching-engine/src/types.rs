use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type OrderId = Uuid;
pub type UserId = Uuid;
pub type Market = String;
pub type Price = rust_decimal::Decimal;
pub type Quantity = rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    #[serde(alias = "buy", alias = "Buy")]
    Buy,
    #[serde(alias = "sell", alias = "Sell")]
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderType {
    #[serde(alias = "limit", alias = "Limit")]
    Limit,
    #[serde(alias = "market", alias = "Market")]
    Market,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: OrderId,
    pub user_id: UserId,
    pub market: Market,
    pub side: Side,
    #[serde(rename = "type")]
    pub order_type: OrderType,
    pub price: Option<Price>,
    pub quantity: Quantity,
    pub remaining: Quantity,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchEvent {
    pub market: Market,
    pub bid_order_id: OrderId,
    pub ask_order_id: OrderId,
    pub bid_user_id: UserId,
    pub ask_user_id: UserId,
    pub taker_order_id: OrderId,
    pub maker_order_id: OrderId,
    pub taker_user_id: UserId,
    pub maker_user_id: UserId,
    pub taker_side: Side,
    pub price: Price,
    pub quantity: Quantity,
    pub timestamp: u64,
}

