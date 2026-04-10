//! Tier-1 /engine/* gate: rate limit, optional IP allowlist, HMAC v2 + Redis nonce dedup.

use axum::{
    body::{to_bytes, Body},
    extract::connect_info::ConnectInfo,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use governor::{clock::DefaultClock, state::keyed::DefaultKeyedStateStore, Quota, RateLimiter};
use hmac::{Hmac, Mac};
use ipnet::IpNet;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<sha2::Sha256>;
type KeyedIpLimiter = RateLimiter<IpAddr, DefaultKeyedStateStore<IpAddr>, DefaultClock>;

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const NONCE_MAX_SKEW_MS: u128 = 60_000;
const NONCE_MAX_LEN: usize = 128;
const HMAC_VERSION: &str = "v2";

fn path_and_query(uri: &axum::http::Uri) -> String {
    let p = uri.path();
    match uri.query() {
        Some(q) => format!("{p}?{q}"),
        None => p.to_string(),
    }
}

fn nonce_time_ms(nonce: &str) -> Option<u128> {
    let head = nonce.split('-').next()?;
    head.parse::<u128>().ok()
}

fn nonce_fresh(nonce: &str) -> bool {
    if nonce.is_empty() || nonce.len() > NONCE_MAX_LEN {
        return false;
    }
    let Some(nonce_ms) = nonce_time_ms(nonce) else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let diff = if now > nonce_ms {
        now - nonce_ms
    } else {
        nonce_ms - now
    };
    diff <= NONCE_MAX_SKEW_MS
}

fn verify_hmac_hex(secret: &[u8], message: &[u8], sig_hex: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    let Ok(sig_bytes) = hex::decode(sig_hex) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret) else {
        return false;
    };
    mac.update(message);
    let expected = mac.finalize().into_bytes();
    if expected.len() != sig_bytes.len() {
        return false;
    }
    subtle::ConstantTimeEq::ct_eq(expected.as_slice(), sig_bytes.as_slice()).into()
}

fn build_message(
    user_id: &str,
    engine_id: &str,
    method: &str,
    path_q: &str,
    body: &[u8],
    nonce: &str,
) -> Vec<u8> {
    let body_str = String::from_utf8_lossy(body);
    let s = format!(
        "{HMAC_VERSION}\n{user_id}\n{engine_id}\n{method}\n{path_q}\n{body_str}\n{nonce}\n"
    );
    s.into_bytes()
}

fn verify_any_hmac(
    active: &[u8],
    old: &[u8],
    message: &[u8],
    sig_hex: &str,
) -> bool {
    verify_hmac_hex(active, message, sig_hex)
        || (!old.is_empty() && verify_hmac_hex(old, message, sig_hex))
}

fn redis_nonce_key(nonce: &str) -> String {
    let mut h = Sha256::new();
    h.update(b"engine:hmac:nonce:");
    h.update(nonce.as_bytes());
    let digest = h.finalize();
    format!("engine:hmac:nonce:{}", hex::encode(digest))
}

fn client_ip_from_request(request: &Request<Body>, peer: SocketAddr, trust_x_forwarded_for: bool) -> IpAddr {
    if trust_x_forwarded_for {
        if let Some(ff) = request
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
        {
            if let Some(first) = ff.split(',').next() {
                if let Ok(ip) = first.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
    }
    peer.ip()
}

fn ip_allowed(ip: IpAddr, nets: &Option<Arc<Vec<IpNet>>>) -> bool {
    let Some(ref list) = nets else {
        return true;
    };
    if list.is_empty() {
        return true;
    }
    list.iter().any(|n| n.contains(&ip))
}

pub async fn engine_hmac_middleware(
    State(state): State<super::AppState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0)
        .unwrap_or_else(|| SocketAddr::from(([0, 0, 0, 0], 0)));

    let client_ip = client_ip_from_request(&request, peer, state.trust_x_forwarded_for);

    if !ip_allowed(client_ip, &state.engine_allow_nets) {
        eprintln!("[engine-hmac] reject reason=ip_not_allowed ip={client_ip}");
        return (StatusCode::FORBIDDEN, "client ip not allowed").into_response();
    }

    if state.engine_ip_limiter.check_key(&client_ip).is_err() {
        eprintln!("[engine-hmac] reject reason=rate_limited ip={client_ip}");
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    }

    let active = state.engine_hmac_active.as_slice();
    if active.is_empty() {
        eprintln!(
            "[engine-hmac] reject reason=no_active_secret path={}",
            request.uri().path()
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "ENGINE_HMAC_SECRET_ACTIVE (or ENGINE_HMAC_SECRET) not configured",
        )
            .into_response();
    }

    let method = request.method().clone();
    let path_q = path_and_query(request.uri());

    let sig_owned = request
        .headers()
        .get("x-signature")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let nonce_owned = request
        .headers()
        .get("x-nonce")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let user_owned = request
        .headers()
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let engine_hdr = request
        .headers()
        .get("x-engine-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let (sig, nonce, user_id, engine_hdr_val) =
        match (sig_owned.as_deref(), nonce_owned.as_deref(), user_owned.as_deref(), engine_hdr.as_deref()) {
            (Some(s), Some(n), Some(u), Some(e)) if !u.is_empty() && !e.is_empty() => (s, n, u, e),
            _ => {
                eprintln!(
                    "[engine-hmac] reject reason=missing_headers method={} path={}",
                    method, path_q
                );
                return (
                    StatusCode::UNAUTHORIZED,
                    "missing x-signature, x-nonce, x-user-id, or x-engine-id",
                )
                    .into_response();
            }
        };

    if engine_hdr_val != state.instance_id.as_str() {
        eprintln!(
            "[engine-hmac] reject reason=engine_id_mismatch path={}",
            path_q
        );
        return (StatusCode::FORBIDDEN, "x-engine-id mismatch").into_response();
    }

    if !nonce_fresh(nonce) {
        eprintln!(
            "[engine-hmac] reject reason=stale_nonce method={} path={}",
            method, path_q
        );
        return (StatusCode::UNAUTHORIZED, "stale or invalid x-nonce").into_response();
    }

    let (parts, body) = request.into_parts();
    let body_bytes = match to_bytes(body, MAX_BODY_BYTES).await {
        Ok(b) => b,
        Err(_) => {
            eprintln!(
                "[engine-hmac] reject reason=body_read method={} path={}",
                method, path_q
            );
            return (StatusCode::BAD_REQUEST, "invalid body").into_response();
        }
    };

    let message = build_message(
        user_id,
        engine_hdr_val,
        method.as_str(),
        &path_q,
        &body_bytes,
        nonce,
    );

    let old = state.engine_hmac_old.as_slice();
    if !verify_any_hmac(active, old, &message, sig) {
        eprintln!(
            "[engine-hmac] reject reason=bad_signature method={} path={}",
            method, path_q
        );
        return (StatusCode::UNAUTHORIZED, "invalid x-signature").into_response();
    }

    let rkey = redis_nonce_key(nonce);
    let Some(mut conn) = state.engine_redis.clone() else {
        eprintln!("[engine-hmac] reject reason=no_redis path={}", path_q);
        return (StatusCode::SERVICE_UNAVAILABLE, "nonce store unavailable").into_response();
    };
    let set_ok: Option<String> = match redis::cmd("SET")
        .arg(&rkey)
        .arg("1")
        .arg("EX")
        .arg(60_i64)
        .arg("NX")
        .query_async(&mut conn)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[engine-hmac] reject reason=redis_error op=SET err={e}");
            return (StatusCode::SERVICE_UNAVAILABLE, "nonce store unavailable").into_response();
        }
    };

    if set_ok.is_none() {
        eprintln!(
            "[engine-hmac] reject reason=replay method={} path={}",
            method, path_q
        );
        return (StatusCode::UNAUTHORIZED, "nonce replay").into_response();
    }

    let req = Request::from_parts(parts, Body::from(body_bytes));
    next.run(req).await
}

pub fn build_keyed_rate_limiter(per_sec: u32) -> Arc<KeyedIpLimiter> {
    let n = NonZeroU32::new(per_sec.max(1)).unwrap();
    Arc::new(RateLimiter::keyed(Quota::per_second(n)))
}

pub fn parse_allow_cidrs(raw: &str) -> Option<Arc<Vec<IpNet>>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let mut v = Vec::new();
    for part in s.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        if let Ok(net) = p.parse::<IpNet>() {
            v.push(net);
        } else if let Ok(ip) = p.parse::<IpAddr>() {
            let net_str = match ip {
                IpAddr::V4(a) => format!("{a}/32"),
                IpAddr::V6(a) => format!("{a}/128"),
            };
            if let Ok(net) = net_str.parse::<IpNet>() {
                v.push(net);
            }
        }
    }
    if v.is_empty() {
        None
    } else {
        Some(Arc::new(v))
    }
}
