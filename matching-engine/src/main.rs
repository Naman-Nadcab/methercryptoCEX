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
struct MatchesResponse {
    events: Vec<crate::types::MatchEvent>,
    next_index: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let engine = Arc::new(Engine::new());
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
    let since_index = q
        .since
        .as_ref()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let (events, next_index) = engine.get_match_events(since_index);
    Json(MatchesResponse {
        events,
        next_index,
    })
}
