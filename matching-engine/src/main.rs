use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use crate::engine::Engine;
use crate::orderbook::OrderBookSnapshot;
use crate::publish_pipeline::{
    init_hot_market_partitions_from_env, match_event_subject, partition_for_market,
    publish_pending_match_event, start_publish_pipeline, stream_match_event_bytes,
    PendingMatchEvent,
};
use crate::types::{MatchEvent, Order};
use crate::persistence::{
    apply_snapshot_to_engine, load_snapshot_from_path, save_snapshot_to_path, EnginePersistenceSnapshot,
};
use crate::wal::{resolve_journal_path, MatchWal, WalPendingEvent};
use async_nats::jetstream::{self, context::Publish};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

mod engine;
mod hmac_auth;
mod orderbook;
mod publish_pipeline;
mod persistence;
mod recovery;
mod types;
mod wal;

#[derive(Clone)]
pub(crate) struct AppState {
    engine: Arc<Engine>,
    instance_id: String,
    jetstream: Option<Arc<jetstream::Context>>,
    /// None when `ENGINE_STREAM_SYNC_PUBLISH=true` (publish under book lock).
    publish_tx: Option<tokio::sync::mpsc::Sender<PendingMatchEvent>>,
    wal: Option<Arc<MatchWal>>,
    partitions: usize,
    engine_hmac_active: Arc<Vec<u8>>,
    engine_hmac_old: Arc<Vec<u8>>,
    engine_redis: Option<redis::aio::ConnectionManager>,
    engine_ip_limiter: Arc<
        governor::RateLimiter<
            std::net::IpAddr,
            governor::state::keyed::DefaultKeyedStateStore<std::net::IpAddr>,
            governor::clock::DefaultClock,
        >,
    >,
    engine_allow_nets: Option<Arc<Vec<ipnet::IpNet>>>,
    /// When false (default), ignore X-Forwarded-For for client IP (use direct peer).
    trust_x_forwarded_for: bool,
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Max match event id from this place (same ids as GET /engine/matches). Lets API persist without polling cursor.
    #[serde(skip_serializing_if = "Option::is_none")]
    last_id: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    events: Vec<EngineMatchEventDto>,
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

fn match_event_to_dto(event_id: usize, e: &MatchEvent) -> EngineMatchEventDto {
    EngineMatchEventDto {
        event_id,
        symbol: e.market.clone(),
        price: e.price.to_string(),
        qty: e.quantity.to_string(),
        taker_order_id: e.taker_order_id.to_string(),
        maker_order_id: e.maker_order_id.to_string(),
        taker_user_id: e.taker_user_id.to_string(),
        maker_user_id: e.maker_user_id.to_string(),
        taker_side: format!("{:?}", e.taker_side).to_lowercase(),
        timestamp: e.timestamp,
    }
}

fn place_ok_response(pairs: &[(usize, MatchEvent)]) -> PlaceResponse {
    if pairs.is_empty() {
        PlaceResponse {
            ok: true,
            error: None,
            last_id: None,
            events: vec![],
        }
    } else {
        let events: Vec<_> = pairs
            .iter()
            .map(|(id, ev)| match_event_to_dto(*id, ev))
            .collect();
        let last_id = events.last().map(|d| d.event_id);
        PlaceResponse {
            ok: true,
            error: None,
            last_id,
            events,
        }
    }
}

fn place_fail_response(message: impl Into<String>) -> PlaceResponse {
    PlaceResponse {
        ok: false,
        error: Some(message.into()),
        last_id: None,
        events: vec![],
    }
}

fn env_truthy(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let s = v.trim().to_ascii_lowercase();
            s == "1" || s == "true" || s == "yes"
        }
        Err(_) => false,
    }
}

fn match_events_partitions() -> usize {
    std::env::var("MATCH_EVENTS_PARTITIONS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1)
        .clamp(1, 64)
}

fn stream_publish_retries() -> usize {
    std::env::var("ENGINE_STREAM_PUBLISH_MAX_RETRIES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8)
        .clamp(1, 32)
}

fn stream_publish_backoff_ms() -> u64 {
    std::env::var("ENGINE_STREAM_PUBLISH_BACKOFF_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
        .clamp(10, 5000)
}

fn tier1_wal_mandatory() -> bool {
    env_truthy("USE_EVENT_STREAM")
        && (env_truthy("ENGINE_TIER1_WAL_REQUIRED") || env_truthy("TIER1_LAUNCH"))
}

fn is_replication_passive() -> bool {
    match std::env::var("ENGINE_REPLICATION_ROLE") {
        Ok(v) => v.trim().eq_ignore_ascii_case("passive"),
        Err(_) => false,
    }
}

/// Default **true** when unset: shrink WAL to unacked `evt` lines before opening the writer.
fn wal_compact_on_start_enabled() -> bool {
    match std::env::var("ENGINE_WAL_COMPACT_ON_START") {
        Ok(v) => {
            let s = v.trim().to_ascii_lowercase();
            s == "1" || s == "true" || s == "yes"
        }
        Err(_) => true,
    }
}

fn snapshot_strict_engine_id() -> bool {
    env_truthy("ENGINE_SNAPSHOT_STRICT_ENGINE_ID")
}

fn snapshot_interval_secs() -> u64 {
    std::env::var("ENGINE_SNAPSHOT_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn wal_rows_for_pairs(
    instance_id: &str,
    partitions: usize,
    pairs: &[(usize, MatchEvent)],
) -> Vec<(usize, String, MatchEvent)> {
    pairs
        .iter()
        .map(|&(id, ref e)| {
            let p = partition_for_market(&e.market, partitions);
            let subject = match_event_subject(instance_id, p);
            (id, subject, e.clone())
        })
        .collect()
}

/// JetStream publish with `Nats-Msg-Id = engine_id:event_id` (stream dedup window) and exponential backoff retries.
async fn publish_match_events_batch_with_retry(
    js: &jetstream::Context,
    subject: String,
    instance_id: &str,
    pairs: &[(usize, MatchEvent)],
) -> Result<(), String> {
    let max_retries = stream_publish_retries();
    let base_ms = stream_publish_backoff_ms();

    for (event_id, e) in pairs {
        let payload: Bytes = stream_match_event_bytes(instance_id, *event_id, e)
            .map_err(|err| format!("match event json encode: {err}"))?
            .into();
        let msg_id = format!("{instance_id}:{event_id}");

        let mut last_err: Option<String> = None;
        for attempt in 0..max_retries {
            let pub_builder = Publish::build()
                .payload(payload.clone())
                .message_id(msg_id.as_str());

            match js.send_publish(subject.clone(), pub_builder).await {
                Ok(ack_fut) => match ack_fut.await {
                    Ok(_) => {
                        last_err = None;
                        break;
                    }
                    Err(err) => {
                        last_err = Some(err.to_string());
                    }
                },
                Err(err) => {
                    last_err = Some(err.to_string());
                }
            }

            if attempt + 1 < max_retries {
                let delay = base_ms.saturating_mul(2u64.saturating_pow(attempt as u32)).min(2000);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }

        if let Some(err) = last_err {
            return Err(format!(
                "jetstream publish failed after {max_retries} attempts (msg_id={msg_id}): {err}"
            ));
        }
    }
    Ok(())
}

async fn publish_partitioned_sync(
    js: &Arc<jetstream::Context>,
    instance_id: &str,
    partitions: usize,
    pairs: &[(usize, MatchEvent)],
) -> Result<(), String> {
    let mut by_part: BTreeMap<usize, Vec<(usize, MatchEvent)>> = BTreeMap::new();
    for &(id, ref e) in pairs {
        let p = partition_for_market(&e.market, partitions);
        by_part.entry(p).or_default().push((id, e.clone()));
    }
    for (p, vec) in by_part {
        let subject = match_event_subject(instance_id, p);
        publish_match_events_batch_with_retry(js, subject, instance_id, &vec).await?;
    }
    Ok(())
}

/// After the orderbook reflects all unacked fills, republish to JetStream (dedup by msg id).
async fn publish_unacked_wal_pending(
    pending: Vec<WalPendingEvent>,
    wal: &Arc<MatchWal>,
    engine_id: &str,
    js: &Arc<jetstream::Context>,
    publish_tx: Option<&tokio::sync::mpsc::Sender<PendingMatchEvent>>,
) -> Result<usize, String> {
    if pending.is_empty() {
        return Ok(0);
    }
    let n = pending.len();
    if let Some(tx) = publish_tx {
        for row in pending {
            let pe = PendingMatchEvent {
                subject: row.subject,
                instance_id: engine_id.to_string(),
                event_id: row.event_id,
                event: row.event,
            };
            tx.send(pe)
                .await
                .map_err(|_| "publish_tx closed during WAL replay".to_string())?;
        }
    } else {
        for row in pending {
            let pe = PendingMatchEvent {
                subject: row.subject,
                instance_id: engine_id.to_string(),
                event_id: row.event_id,
                event: row.event,
            };
            publish_pending_match_event(js.as_ref(), &pe).await?;
            wal.append_ack(pe.event_id)?;
        }
    }
    Ok(n)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    init_hot_market_partitions_from_env();

    let engine = Arc::new(Engine::new());
    let instance_id = std::env::var("ENGINE_INSTANCE_ID").unwrap_or_else(|_| "default".to_string());
    let partitions = match_events_partitions();

    let jetstream = if env_truthy("USE_EVENT_STREAM") {
        let url = std::env::var("NATS_URL").unwrap_or_default();
        if url.trim().is_empty() {
            eprintln!("[engine] FATAL: USE_EVENT_STREAM=true requires NATS_URL");
            std::process::exit(1);
        }
        match async_nats::connect(url.trim()).await {
            Ok(nc) => {
                eprintln!(
                    "[engine] JetStream enabled (partitions={partitions}, subjects match.events.{instance_id}.p*)"
                );
                Some(Arc::new(jetstream::new(nc)))
            }
            Err(e) => {
                eprintln!("[engine] FATAL: USE_EVENT_STREAM=true but NATS connect failed: {e}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let wal_path_raw = std::env::var("ENGINE_MATCH_WAL_PATH").unwrap_or_default();
    if tier1_wal_mandatory() && wal_path_raw.trim().is_empty() {
        eprintln!(
            "[engine] FATAL: USE_EVENT_STREAM with ENGINE_TIER1_WAL_REQUIRED or TIER1_LAUNCH requires ENGINE_MATCH_WAL_PATH"
        );
        std::process::exit(1);
    }

    let wal: Option<Arc<MatchWal>> = if wal_path_raw.trim().is_empty() {
        None
    } else {
        let path = match resolve_journal_path(wal_path_raw.trim()) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[engine] FATAL: {e}");
                std::process::exit(1);
            }
        };
        if path.exists() && wal_compact_on_start_enabled() {
            if let Err(e) = MatchWal::compact_journal_keep_unacked_only(&instance_id, &path) {
                eprintln!("[engine] FATAL: WAL compact: {e}");
                std::process::exit(1);
            }
        }
        match MatchWal::open_resolved(path) {
            Ok(w) => Some(w),
            Err(e) => {
                eprintln!("[engine] FATAL: {e}");
                std::process::exit(1);
            }
        }
    };

    let publish_tx = if jetstream.is_some() && !env_truthy("ENGINE_STREAM_SYNC_PUBLISH") {
        let js = jetstream.clone().unwrap();
        let cap = std::env::var("ENGINE_PUBLISH_QUEUE_CAPACITY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(262_144)
            .clamp(1024, 2_097_152);
        let batch = std::env::var("ENGINE_PUBLISH_BATCH_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(64)
            .clamp(1, 512);
        let parallel = std::env::var("ENGINE_PUBLISH_PARALLEL")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(32)
            .clamp(1, 256);
        let wal_ack = wal.clone();
        let (tx, h) = start_publish_pipeline(js, cap, batch, parallel, wal_ack);
        std::mem::forget(h);
        Some(tx)
    } else {
        None
    };

    let backend_url = std::env::var("ENGINE_BACKEND_URL").ok();
    let snap_path_raw = std::env::var("ENGINE_PERSISTENCE_SNAPSHOT_PATH").unwrap_or_default();
    let mut loaded_from_snapshot = false;

    if !snap_path_raw.trim().is_empty() {
        let sp = Path::new(snap_path_raw.trim());
        if sp.exists() {
            match std::fs::metadata(sp) {
                Ok(m) if m.len() > 0 => match load_snapshot_from_path(sp) {
                    Ok(snap) => {
                        if snap.engine_id != instance_id {
                            eprintln!(
                                "[engine] WARN: snapshot engine_id={} != ENGINE_INSTANCE_ID={}",
                                snap.engine_id, instance_id
                            );
                            if snapshot_strict_engine_id() {
                                eprintln!("[engine] FATAL: ENGINE_SNAPSHOT_STRICT_ENGINE_ID");
                                std::process::exit(1);
                            }
                        }
                        apply_snapshot_to_engine(&engine, snap);
                        loaded_from_snapshot = true;
                        eprintln!(
                            "[engine] loaded persistence snapshot {} (book + applied ids)",
                            sp.display()
                        );
                    }
                    Err(e) => {
                        eprintln!("[engine] FATAL: snapshot load: {e}");
                        std::process::exit(1);
                    }
                },
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[engine] FATAL: snapshot stat: {e}");
                    std::process::exit(1);
                }
            }
        }
    }

    if !loaded_from_snapshot {
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
    }

    let wal_pending: Vec<WalPendingEvent> = if let Some(ref w) = wal {
        match MatchWal::scan_unacked_for_engine(&instance_id, w.path()) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[engine] FATAL: WAL scan: {e}");
                std::process::exit(1);
            }
        }
    } else {
        vec![]
    };

    for row in &wal_pending {
        if let Err(e) = engine.apply_replay_event(row.event_id, &row.event) {
            eprintln!(
                "[engine] FATAL: WAL→book event_id={} (align orderbook before stream): {e}",
                row.event_id
            );
            std::process::exit(1);
        }
    }
    if !wal_pending.is_empty() {
        eprintln!(
            "[engine] WAL→book: {} unacked evt row(s) idempotent-aligned",
            wal_pending.len()
        );
    }

    if jetstream.is_some() && wal.is_some() && !is_replication_passive() {
        let js = jetstream.as_ref().unwrap();
        let w = wal.as_ref().unwrap();
        match publish_unacked_wal_pending(
            wal_pending,
            w,
            &instance_id,
            js,
            publish_tx.as_ref(),
        )
        .await
        {
            Ok(0) => {}
            Ok(n) => eprintln!("[engine] stream replay enqueued/published {n} event(s)"),
            Err(e) => {
                eprintln!("[engine] FATAL: stream replay: {e}");
                std::process::exit(1);
            }
        }
    }

    let snap_interval = snapshot_interval_secs();
    if snap_interval > 0 {
        if snap_path_raw.trim().is_empty() {
            eprintln!(
                "[engine] WARN: ENGINE_SNAPSHOT_INTERVAL_SECS={snap_interval} but ENGINE_PERSISTENCE_SNAPSHOT_PATH unset"
            );
        } else {
            let path_buf = PathBuf::from(snap_path_raw.trim());
            let eng = engine.clone();
            let eid = instance_id.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_secs(snap_interval.max(5)));
                loop {
                    tick.tick().await;
                    let eng2 = eng.clone();
                    let eid2 = eid.clone();
                    let path2 = path_buf.clone();
                    match tokio::task::spawn_blocking(move || {
                        let snap = EnginePersistenceSnapshot::from_engine(&eng2, &eid2);
                        save_snapshot_to_path(&path2, &snap)
                    })
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => eprintln!("[engine] periodic snapshot failed: {e}"),
                        Err(e) => eprintln!("[engine] periodic snapshot task: {e}"),
                    }
                }
            });
            eprintln!(
                "[engine] periodic persistence snapshot every {}s → {}",
                snap_interval.max(5),
                snap_path_raw.trim()
            );
        }
    }

    let active_raw = std::env::var("ENGINE_HMAC_SECRET_ACTIVE")
        .or_else(|_| std::env::var("ENGINE_HMAC_SECRET"))
        .unwrap_or_default();
    let engine_hmac_active = Arc::new(active_raw.into_bytes());
    let old_raw = std::env::var("ENGINE_HMAC_SECRET_OLD").unwrap_or_default();
    let engine_hmac_old = Arc::new(old_raw.into_bytes());

    let redis_url = std::env::var("ENGINE_REDIS_URL")
        .or_else(|_| std::env::var("REDIS_URL"))
        .unwrap_or_default();
    let engine_redis: Option<redis::aio::ConnectionManager> = if engine_hmac_active.is_empty() {
        None
    } else {
        if redis_url.trim().is_empty() {
            eprintln!("[engine] FATAL: HMAC active secret set but ENGINE_REDIS_URL / REDIS_URL is empty (required for nonce dedup)");
            std::process::exit(1);
        }
        let redis_client = redis::Client::open(redis_url.trim()).unwrap_or_else(|e| {
            eprintln!("[engine] FATAL: invalid ENGINE_REDIS_URL / REDIS_URL: {e}");
            std::process::exit(1);
        });
        Some(
            redis::aio::ConnectionManager::new(redis_client)
                .await
                .unwrap_or_else(|e| {
                    eprintln!("[engine] FATAL: Redis connection failed: {e}");
                    std::process::exit(1);
                }),
        )
    };

    let rps: u32 = std::env::var("ENGINE_HTTP_RATE_LIMIT_PER_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(400)
        .clamp(10, 50_000);
    let engine_ip_limiter = hmac_auth::build_keyed_rate_limiter(rps);

    let allow_raw = std::env::var("ENGINE_CLIENT_ALLOW_CIDRS").unwrap_or_default();
    let engine_allow_nets = hmac_auth::parse_allow_cidrs(&allow_raw);
    let trust_x_forwarded_for = env_truthy("ENGINE_TRUST_X_FORWARDED_FOR");

    let state = AppState {
        engine: engine.clone(),
        instance_id: instance_id.clone(),
        jetstream: jetstream.clone(),
        publish_tx,
        wal,
        partitions,
        engine_hmac_active,
        engine_hmac_old,
        engine_redis,
        engine_ip_limiter,
        engine_allow_nets,
        trust_x_forwarded_for,
    };

    let engine_api = Router::new()
        .route("/place", post(place))
        .route("/cancel", post(cancel))
        .route("/snapshot", get(snapshot))
        .route("/matches", get(matches))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            hmac_auth::engine_hmac_middleware,
        ))
        .with_state(state.clone());

    let app = Router::new()
        .route("/health", get(health))
        .nest("/engine", engine_api)
        .with_state(state);

    let port: u16 = std::env::var("ENGINE_HTTP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7101);
    let bind: std::net::IpAddr = std::env::var("ENGINE_HTTP_BIND")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()
        .unwrap_or(std::net::Ipv4Addr::LOCALHOST.into());
    let addr = SocketAddr::from((bind, port));
    eprintln!(
        "[engine] listening on {} (instance_id={}, bind={})",
        addr, instance_id, bind
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let stream_mode = if state.jetstream.is_some() {
        if state.publish_tx.is_some() {
            "async_partitioned"
        } else {
            "sync_partitioned"
        }
    } else {
        "off"
    };
    let replication_role = if is_replication_passive() {
        "passive"
    } else {
        "active"
    };
    Json(serde_json::json!({
        "ok": true,
        "status": "healthy",
        "engine_id": state.instance_id,
        "match_events_partitions": state.partitions,
        "stream_publish_mode": stream_mode,
        "match_wal_enabled": state.wal.is_some(),
        "tier1_wal_mandatory_configured": tier1_wal_mandatory(),
        "replication_role": replication_role,
    }))
}

async fn place(State(state): State<AppState>, Json(order): Json<Order>) -> impl IntoResponse {
    if is_replication_passive() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(place_fail_response(
                "ENGINE_REPLICATION_ROLE=passive (read-only replica)",
            )),
        )
            .into_response();
    }

    if state.jetstream.is_none() {
        let engine = state.engine.clone();
        let pairs = match tokio::task::spawn_blocking(move || engine.place_order(order)).await {
            Ok(p) => p,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(place_fail_response("place_order join failed")),
                )
                    .into_response();
            }
        };
        return (
            StatusCode::OK,
            Json(place_ok_response(&pairs)),
        )
            .into_response();
    }

    let js = state.jetstream.clone().expect("jetstream");
    let instance_id = state.instance_id.clone();
    let partitions = state.partitions;
    let engine = state.engine.clone();

    if env_truthy("ENGINE_STREAM_SYNC_PUBLISH") {
        let wal_sync = state.wal.clone();
        let result = if let Some(w) = wal_sync {
            let w_ack = Arc::clone(&w);
            let iid_wal = instance_id.clone();
            let iid_pub = instance_id.clone();
            tokio::task::spawn_blocking(move || {
                engine.place_order_wal_publish_commit_book(
                    order,
                    move |pairs| {
                        if pairs.is_empty() {
                            return Ok(());
                        }
                        let rows = wal_rows_for_pairs(&iid_wal, partitions, pairs);
                        w.append_events_batch(&iid_wal, &rows)
                    },
                    move |pairs| {
                        if pairs.is_empty() {
                            return Ok(());
                        }
                        tokio::runtime::Handle::current().block_on(async {
                            publish_partitioned_sync(&js, &iid_pub, partitions, pairs).await
                        })?;
                        for (id, _) in pairs {
                            w_ack.append_ack(*id)?;
                        }
                        Ok(())
                    },
                )
            })
            .await
        } else {
            tokio::task::spawn_blocking(move || {
                engine.place_order_commit_after_publish(order, |pairs: &[(usize, MatchEvent)]| {
                    if pairs.is_empty() {
                        return Ok(());
                    }
                    tokio::runtime::Handle::current().block_on(async {
                        publish_partitioned_sync(&js, &instance_id, partitions, pairs).await
                    })
                })
            })
            .await
        };

        return match result {
            Ok(Ok(pairs)) => (
                StatusCode::OK,
                Json(place_ok_response(&pairs)),
            )
                .into_response(),
            Ok(Err(e)) => {
                eprintln!("[engine] place rejected (sync publish): {e}");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(place_fail_response(e)),
                )
                    .into_response()
            }
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(place_fail_response("place task join failed")),
            )
                .into_response(),
        };
    }

    let wal = state.wal.clone();
    let publish_tx = match state.publish_tx.clone() {
        Some(tx) => tx,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(place_fail_response("publish pipeline not initialized")),
            )
                .into_response();
        }
    };

    let pairs_result = if let Some(w) = wal.clone() {
        let sid = state.instance_id.clone();
        let parts = state.partitions;
        tokio::task::spawn_blocking(move || {
            engine.place_order_wal_then_commit_book(order, |pairs| {
                if pairs.is_empty() {
                    return Ok(());
                }
                let rows = wal_rows_for_pairs(&sid, parts, pairs);
                w.append_events_batch(&sid, &rows)
            })
        })
        .await
    } else {
        tokio::task::spawn_blocking(move || Ok::<_, String>(engine.place_order(order))).await
    };

    let pairs = match pairs_result {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(place_fail_response(e)),
            )
                .into_response();
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(place_fail_response("place_order join failed")),
            )
                .into_response();
        }
    };

    if pairs.is_empty() {
        return (
            StatusCode::OK,
            Json(place_ok_response(&pairs)),
        )
            .into_response();
    }

    let place_body = place_ok_response(&pairs);
    for (event_id, e) in pairs {
        let p = partition_for_market(&e.market, partitions);
        let subject = match_event_subject(&instance_id, p);
        let pe = PendingMatchEvent {
            subject,
            instance_id: instance_id.clone(),
            event_id,
            event: e,
        };
        if publish_tx.send(pe).await.is_err() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(place_fail_response(
                    "publish pipeline closed — WAL retains evt for replay",
                )),
            )
                .into_response();
        }
    }

    (StatusCode::OK, Json(place_body)).into_response()
}

async fn cancel(State(state): State<AppState>, Json(body): Json<CancelRequest>) -> impl IntoResponse {
    if is_replication_passive() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "ok": false,
                "error": "ENGINE_REPLICATION_ROLE=passive (read-only replica)"
            })),
        )
            .into_response();
    }
    let _ = state.engine.cancel_order(body.order_id);
    (StatusCode::OK, Json(CancelResponse { ok: true })).into_response()
}

async fn snapshot(
    State(state): State<AppState>,
    Query(q): Query<SnapshotQuery>,
) -> Json<SnapshotResponse> {
    let markets = state.engine.snapshot(q.market.as_deref());
    Json(SnapshotResponse { markets })
}

async fn matches(
    State(state): State<AppState>,
    Query(q): Query<MatchesQuery>,
) -> Json<MatchesResponse> {
    let after_id = q
        .after_id
        .as_ref()
        .or(q.since.as_ref())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let (events, last_id) = state.engine.get_match_events_after(after_id);
    let dto: Vec<EngineMatchEventDto> = events
        .into_iter()
        .map(|(event_id, e)| match_event_to_dto(event_id, &e))
        .collect();
    Json(MatchesResponse { last_id, events: dto })
}
