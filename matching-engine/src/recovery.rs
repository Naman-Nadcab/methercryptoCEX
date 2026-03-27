//! Restart-safe orderbook recovery from backend.
//! On startup, fetch open orders and last_engine_event_id, then rebuild in-memory orderbook.

use crate::engine::Engine;
use crate::types::Order;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

const FETCH_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Deserialize)]
struct BackendOrder {
    id: String,
    user_id: String,
    market: String,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    price: Option<String>,
    quantity: String,
    remaining: String,
    created_at: u64,
}

#[derive(Debug, Deserialize)]
struct BackendState {
    orders: Vec<BackendOrder>,
    last_engine_event_id: u64,
}

fn parse_order(bo: BackendOrder) -> Result<Order, String> {
    use crate::types::{OrderType, Side};
    use rust_decimal::Decimal;
    use std::str::FromStr;
    use uuid::Uuid;

    let id = Uuid::parse_str(&bo.id).map_err(|e| format!("invalid order id {}: {}", bo.id, e))?;
    let user_id = Uuid::parse_str(&bo.user_id).map_err(|e| format!("invalid user_id {}: {}", bo.user_id, e))?;
    let quantity = Decimal::from_str(&bo.quantity).map_err(|e| format!("invalid quantity: {}", e))?;
    let remaining = Decimal::from_str(&bo.remaining).map_err(|e| format!("invalid remaining: {}", e))?;
    let price = match bo.price {
        Some(p) if !p.is_empty() => Some(Decimal::from_str(&p).map_err(|e| format!("invalid price: {}", e))?),
        _ => None,
    };
    let side = match bo.side.as_str() {
        "BUY" | "buy" => Side::Buy,
        "SELL" | "sell" => Side::Sell,
        _ => return Err(format!("invalid side: {}", bo.side)),
    };
    let order_type = match bo.order_type.as_str() {
        "LIMIT" | "limit" => OrderType::Limit,
        "MARKET" | "market" => OrderType::Market,
        _ => return Err(format!("invalid type: {}", bo.order_type)),
    };

    Ok(Order {
        id,
        user_id,
        market: bo.market,
        side,
        order_type,
        price,
        quantity,
        remaining,
        created_at: bo.created_at,
    })
}

/// Fetch open orders and last_engine_event_id from backend. Returns (orders, last_engine_event_id).
pub async fn fetch_state_from_backend(
    backend_url: &str,
    secret: Option<&str>,
) -> Result<(Vec<Order>, usize), Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("{}/internal/engine/state", backend_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()?;

    let mut req = client.get(&url);
    if let Some(s) = secret {
        req = req.header("X-Engine-Secret", s);
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("backend returned {}: {}", status, body).into());
    }
    let state: BackendState = res.json().await?;

    let orders: Result<Vec<_>, _> = state.orders.into_iter().map(parse_order).collect();
    let orders = orders.map_err(|e| e.to_string())?;
    let last_id = state.last_engine_event_id as usize;
    Ok((orders, last_id))
}

/// Rebuild engine orderbook from backend. On failure returns error (caller should exit).
pub async fn rebuild_orderbook_from_backend(
    engine: &Arc<Engine>,
    backend_url: &str,
    secret: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (orders, last_engine_event_id) = fetch_state_from_backend(backend_url, secret).await?;
    engine.restore_orderbook(orders, last_engine_event_id);
    Ok(())
}
