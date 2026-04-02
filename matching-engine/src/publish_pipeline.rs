//! Async JetStream publish path: orderbook lock is not held during NATS I/O.
//! Batched, parallel publishes for throughput; WAL `ack` lines after each successful publish.

use crate::types::MatchEvent;
use crate::wal::MatchWal;
use async_nats::jetstream::{self, context::Publish};
use bytes::Bytes;
use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct PendingMatchEvent {
    pub subject: String,
    pub instance_id: String,
    pub event_id: usize,
    pub event: MatchEvent,
}


static HOT_MARKET_PARTITIONS: OnceLock<HashMap<String, usize>> = OnceLock::new();

/// `HOT_MARKET_PARTITION_MAP=BTC_USDT:7,ETH_USDT:3` pins symbols to a partition index (clamped).
pub fn init_hot_market_partitions_from_env() {
    let m = parse_hot_market_partition_map();
    let _ = HOT_MARKET_PARTITIONS.set(m);
}

fn parse_hot_market_partition_map() -> HashMap<String, usize> {
    let raw = std::env::var("HOT_MARKET_PARTITION_MAP").unwrap_or_default();
    let mut out = HashMap::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some((sym, idx)) = part.split_once(':') else {
            eprintln!("[engine] HOT_MARKET_PARTITION_MAP skip (expected SYMBOL:idx): {part}");
            continue;
        };
        let sym = sym.trim();
        if sym.is_empty() {
            continue;
        }
        if let Ok(p) = idx.trim().parse::<usize>() {
            out.insert(sym.to_string(), p);
        }
    }
    out
}

pub fn partition_for_market(market: &str, partitions: usize) -> usize {
    if partitions <= 1 {
        return 0;
    }
    if let Some(m) = HOT_MARKET_PARTITIONS.get() {
        if let Some(&p) = m.get(market) {
            return p.min(partitions.saturating_sub(1));
        }
    }
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    market.hash(&mut h);
    (h.finish() as usize) % partitions
}

pub fn match_event_subject(instance_id: &str, partition: usize) -> String {
    format!("match.events.{instance_id}.p{partition}")
}

pub fn stream_match_event_bytes(instance_id: &str, event_id: usize, e: &MatchEvent) -> Result<Vec<u8>, serde_json::Error> {
    #[derive(Serialize)]
    struct Body<'a> {
        engine_id: &'a str,
        event_id: usize,
        symbol: &'a str,
        price: String,
        qty: String,
        taker_order_id: String,
        maker_order_id: String,
        taker_user_id: String,
        maker_user_id: String,
        taker_side: String,
        timestamp: u64,
    }
    let body = Body {
        engine_id: instance_id,
        event_id,
        symbol: &e.market,
        price: e.price.to_string(),
        qty: e.quantity.to_string(),
        taker_order_id: e.taker_order_id.to_string(),
        maker_order_id: e.maker_order_id.to_string(),
        taker_user_id: e.taker_user_id.to_string(),
        maker_user_id: e.maker_user_id.to_string(),
        taker_side: format!("{:?}", e.taker_side).to_lowercase(),
        timestamp: e.timestamp,
    };
    serde_json::to_vec(&body)
}

fn publish_retries() -> usize {
    std::env::var("ENGINE_STREAM_PUBLISH_MAX_RETRIES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8)
        .clamp(1, 32)
}

fn publish_backoff_ms() -> u64 {
    std::env::var("ENGINE_STREAM_PUBLISH_BACKOFF_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
        .clamp(10, 5000)
}

pub async fn publish_pending_match_event(
    js: &jetstream::Context,
    item: &PendingMatchEvent,
) -> Result<(), String> {
    publish_one_with_retry(js, item).await
}

async fn publish_one_with_retry(
    js: &jetstream::Context,
    item: &PendingMatchEvent,
) -> Result<(), String> {
    let payload: Bytes = stream_match_event_bytes(&item.instance_id, item.event_id, &item.event)
        .map_err(|e| format!("json: {e}"))?
        .into();
    let msg_id = format!("{}:{}", item.instance_id, item.event_id);
    let max_retries = publish_retries();
    let base_ms = publish_backoff_ms();
    let subject = item.subject.clone();

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
                Err(err) => last_err = Some(err.to_string()),
            },
            Err(err) => last_err = Some(err.to_string()),
        }

        if attempt + 1 < max_retries {
            let delay = base_ms.saturating_mul(2u64.saturating_pow(attempt as u32)).min(2000);
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    }

    if let Some(err) = last_err {
        return Err(format!(
            "jetstream publish failed (msg_id={msg_id}) after {max_retries} attempts: {err}"
        ));
    }
    Ok(())
}

/// Spawn background publisher; returns sender for enqueue (call after each match).
pub fn start_publish_pipeline(
    js: Arc<jetstream::Context>,
    queue_capacity: usize,
    batch_max: usize,
    parallel: usize,
    wal_ack: Option<Arc<MatchWal>>,
) -> (mpsc::Sender<PendingMatchEvent>, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = mpsc::channel::<PendingMatchEvent>(queue_capacity);
    let parallel = parallel.clamp(1, 256);
    let batch_max = batch_max.clamp(1, 512);
    let wal_for_ack = wal_ack.clone();

    let handle = tokio::spawn(async move {
        let mut batch: Vec<PendingMatchEvent> = Vec::with_capacity(batch_max);
        loop {
            if batch.is_empty() {
                match rx.recv().await {
                    Some(e) => batch.push(e),
                    None => break,
                }
            }
            while batch.len() < batch_max {
                match rx.try_recv() {
                    Ok(e) => batch.push(e),
                    Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                        if batch.is_empty() {
                            return;
                        }
                        break;
                    }
                }
            }

            let drained: Vec<PendingMatchEvent> = batch.drain(..).collect();
            let js_ref = js.clone();
            let results: Vec<_> = stream::iter(drained)
                .map(|item| {
                    let js = js_ref.clone();
                    async move {
                        let r = publish_one_with_retry(&js, &item).await;
                        (item, r)
                    }
                })
                .buffer_unordered(parallel)
                .collect()
                .await;

            for (item, r) in results {
                match r {
                    Ok(()) => {
                        if let Some(w) = wal_for_ack.as_ref() {
                            if let Err(e) = w.append_ack(item.event_id) {
                                eprintln!(
                                    "[engine] CRITICAL: wal ack append failed event_id={} — replay may duplicate publish (JetStream dedup): {}",
                                    item.event_id, e
                                );
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[engine] CRITICAL: async publish failed after retries — unacked WAL evt will replay on restart: {} (subject={})",
                            e, item.subject
                        );
                    }
                }
            }
        }
    });

    (tx, handle)
}
