use axum::extract::State;
use axum::{routing::post, Json, Router};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
struct ValidateRequest {
    session_id: String,
    device_id: Option<String>,
    ip_hash: Option<String>,
}

#[derive(Debug, Serialize)]
struct ValidateResponse {
    session_id: String,
    user_id: Option<String>,
    auth_flags: u32,
    risk_state: String,
    expires_at: Option<String>,
}

async fn validate(Json(body): Json<ValidateRequest>) -> Json<ValidateResponse> {
    let start = Instant::now();
    let out = Json(ValidateResponse {
        session_id: body.session_id,
        user_id: None,
        auth_flags: 0,
        risk_state: "none".to_string(),
        expires_at: None,
    });
    let ns = start.elapsed().as_nanos();
    if ns > 5_000_000 {
        eprintln!("[SLOW] validate {} ns", ns);
    }
    out
}

#[derive(Debug, Deserialize)]
struct LockRequest {
    key: String,
    ttl_ms: u64,
}

#[derive(Debug, Serialize)]
struct LockResponse {
    acquired: bool,
}

fn try_acquire(store: &DashMap<String, Instant>, key: String, ttl_ms: u64) -> bool {
    let now = Instant::now();
    let expiry = now + Duration::from_millis(ttl_ms);
    if key.is_empty() {
        return false;
    }
    match store.entry(key) {
        dashmap::mapref::entry::Entry::Occupied(mut occ) => {
            if *occ.get() > now {
                return false;
            }
            occ.insert(expiry);
            true
        }
        dashmap::mapref::entry::Entry::Vacant(vac) => {
            vac.insert(expiry);
            true
        }
    }
}

async fn lock(
    State(store): State<Arc<DashMap<String, Instant>>>,
    Json(body): Json<LockRequest>,
) -> Json<LockResponse> {
    let start = Instant::now();
    let acquired = try_acquire(store.as_ref(), body.key, body.ttl_ms);
    let out = Json(LockResponse { acquired });
    let ns = start.elapsed().as_nanos();
    if ns > 5_000_000 {
        eprintln!("[SLOW] lock {} ns", ns);
    }
    out
}

fn cleanup_expired(store: Arc<DashMap<String, Instant>>) {
    let now = Instant::now();
    store.retain(|_, expiry| *expiry > now);
}

#[tokio::main]
async fn main() {
    let lock_store: Arc<DashMap<String, Instant>> = Arc::new(DashMap::new());
    let store_clone = Arc::clone(&lock_store);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            cleanup_expired(Arc::clone(&store_clone));
        }
    });

    let app = Router::new()
        .route("/validate", post(validate))
        .route("/lock", post(lock))
        .with_state(lock_store);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:7001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
