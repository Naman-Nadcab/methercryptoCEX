use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use crate::engine::Engine;
use crate::orderbook::OrderBookSnapshot;
use crate::types::Order;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

mod engine;
mod orderbook;
mod recovery;
mod types;

#[derive(Debug, Deserialize)]
struct CancelRequest {
    order_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct SnapshotQuery {
    market: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MatchesQuery {
    since: Option<String>,
    after_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct PlaceResponse {
    ok: bool,
}

#[derive(Debug, Serialize)]
struct CancelResponse {
    ok: bool,
}

#[derive(Debug, Serialize)]
struct SnapshotResponse {
    markets: std::collections::HashMap<String, OrderBookSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct EngineMatchEventDto {
    event_id: usize,
    symbol: String,
    price: String,
    qty: String,
    taker_order_id: String,
    maker_order_id: String,
    taker_user_id: String,
    maker_user_id: String,
    taker_side: String,
    timestamp: u64,
}

#[derive(Debug, Serialize)]
struct MatchesResponse {
    last_id: usize,
    events: Vec<EngineMatchEventDto>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let engine = Arc::new(Engine::new());

    // Tier-1: restart-safe orderbook recovery from backend
    let backend_url = std::env::var("ENGINE_BACKEND_URL").ok();
    if let Some(ref url) = backend_url {
        let secret = std::env::var("ENGINE_INTERNAL_SECRET").ok();
        match recovery::rebuild_orderbook_from_backend(&engine, url, secret.as_deref()).await {
            Ok(()) => eprintln!("[engine] orderbook rebuilt from backend (restart-safe)"),
            Err(e) => {
                eprintln!("[engine] FATAL: orderbook rebuild failed: {}", e);
                eprintln!("[engine] Refusing startup. Fix backend connectivity or set ENGINE_BACKEND_URL=\"\" to skip.");
                std::process::exit(1);
            }
        }
    }

    let app = Router::new()
        .route("/engine/place", post(place))
        .route("/engine/cancel", post(cancel))
        .route("/engine/snapshot", get(snapshot))
        .route("/engine/matches", get(matches))
        .with_state(engine);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 7101));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn place(State(engine): State<Arc<Engine>>, Json(order): Json<Order>) -> Json<PlaceResponse> {
    let _ = engine.place_order(order);
    Json(PlaceResponse { ok: true })
}

async fn cancel(
    State(engine): State<Arc<Engine>>,
    Json(body): Json<CancelRequest>,
) -> Json<CancelResponse> {
    let _ = engine.cancel_order(body.order_id);
    Json(CancelResponse { ok: true })
}

async fn snapshot(
    State(engine): State<Arc<Engine>>,
    Query(q): Query<SnapshotQuery>,
) -> Json<SnapshotResponse> {
    let markets = engine.snapshot(q.market.as_deref());
    Json(SnapshotResponse { markets })
}

async fn matches(
    State(engine): State<Arc<Engine>>,
    Query(q): Query<MatchesQuery>,
) -> Json<MatchesResponse> {
    let after_id = q
        .after_id
        .as_ref()
        .or(q.since.as_ref())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let (events, last_id) = engine.get_match_events_after(after_id);
    let dto: Vec<EngineMatchEventDto> = events
        .into_iter()
        .map(|(event_id, e)| EngineMatchEventDto {
            event_id,
            symbol: e.market,
            price: e.price.to_string(),
            qty: e.quantity.to_string(),
            taker_order_id: e.taker_order_id.to_string(),
            maker_order_id: e.maker_order_id.to_string(),
            taker_user_id: e.taker_user_id.to_string(),
            maker_user_id: e.maker_user_id.to_string(),
            taker_side: format!("{:?}", e.taker_side).to_lowercase(),
            timestamp: e.timestamp,
        })
        .collect();
    Json(MatchesResponse { last_id, events: dto })
}
