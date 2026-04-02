//! On-disk engine state: order books, `next_event_id`, and book-applied match ids for idempotent WAL replay.

use crate::engine::Engine;
use crate::types::Order;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

pub const SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnginePersistenceSnapshot {
    pub v: u32,
    pub engine_id: String,
    pub next_event_id: usize,
    /// Match event ids whose fills are already reflected in `orders` (remaining quantities).
    #[serde(default)]
    pub book_applied_match_event_ids: Vec<usize>,
    pub orders: Vec<Order>,
}

impl EnginePersistenceSnapshot {
    pub fn from_engine(engine: &Engine, engine_id: &str) -> Self {
        let orders = engine.collect_all_orders();
        let book_applied = engine.book_applied_match_ids_snapshot();
        let next_event_id = engine.next_event_id_value();
        Self {
            v: SNAPSHOT_VERSION,
            engine_id: engine_id.to_string(),
            next_event_id,
            book_applied_match_event_ids: book_applied,
            orders,
        }
    }
}

pub fn load_snapshot_from_path(path: &Path) -> Result<EnginePersistenceSnapshot, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read snapshot {}: {e}", path.display()))?;
    let snap: EnginePersistenceSnapshot =
        serde_json::from_str(&raw).map_err(|e| format!("parse snapshot: {e}"))?;
    if snap.v != SNAPSHOT_VERSION {
        return Err(format!("unsupported snapshot version {} (want {SNAPSHOT_VERSION})", snap.v));
    }
    Ok(snap)
}

pub fn save_snapshot_to_path(path: &Path, snap: &EnginePersistenceSnapshot) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir).map_err(|e| format!("snapshot mkdir: {e}"))?;
        }
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(snap).map_err(|e| format!("snapshot json: {e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("write snapshot tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename snapshot: {e}"))?;
    Ok(())
}

/// Apply snapshot into engine (clears prior books, ring buffer, and applied-id set, then loads).
pub fn apply_snapshot_to_engine(engine: &Arc<Engine>, snap: EnginePersistenceSnapshot) {
    let set: HashSet<usize> = snap.book_applied_match_event_ids.iter().copied().collect();
    engine.restore_from_persistence_snapshot(snap.orders, snap.next_event_id, set);
}
