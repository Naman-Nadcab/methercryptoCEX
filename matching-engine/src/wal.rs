//! Durable match-event journal: `evt` lines before book commit, `ack` lines after JetStream ack.
//! Unacked `evt` rows are replayed on startup so publishes are not lost across crashes.

use crate::types::MatchEvent;
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;

const WAL_VERSION: u32 = 1;

#[derive(Clone, Debug)]
pub struct WalPendingEvent {
    pub event_id: usize,
    pub subject: String,
    pub event: MatchEvent,
}

/// Resolve `ENGINE_MATCH_WAL_PATH`: file path, or directory → `<dir>/match_events.jsonl`.
pub fn resolve_journal_path(raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("ENGINE_MATCH_WAL_PATH is empty".into());
    }
    let p = Path::new(raw);
    if raw.ends_with('/') || p.is_dir() {
        std::fs::create_dir_all(p).map_err(|e| format!("wal mkdir {}: {e}", p.display()))?;
        Ok(p.join("match_events.jsonl"))
    } else {
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("wal mkdir {}: {e}", parent.display()))?;
            }
        }
        Ok(p.to_path_buf())
    }
}

#[derive(Deserialize)]
struct WalEvtLine {
    engine_id: String,
    event_id: usize,
    subject: String,
    payload: MatchEvent,
}

pub struct MatchWal {
    writer: Mutex<BufWriter<File>>,
    path: PathBuf,
}

impl MatchWal {
    pub fn open_resolved(path: PathBuf) -> Result<Arc<Self>, String> {
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("wal open {}: {e}", path.display()))?;
        eprintln!("[engine] match WAL journal: {}", path.display());
        Ok(Arc::new(Self {
            writer: Mutex::new(BufWriter::new(f)),
            path,
        }))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one `evt` line per match, then fsync (Tier-1: before committing the orderbook).
    pub fn append_events_batch(
        &self,
        engine_id: &str,
        items: &[(usize, String, MatchEvent)],
    ) -> Result<(), String> {
        let mut w = self.writer.lock();
        for &(event_id, ref subject, ref ev) in items {
            let payload = serde_json::to_value(ev).map_err(|e| e.to_string())?;
            let line = serde_json::json!({
                "t": "evt",
                "v": WAL_VERSION,
                "engine_id": engine_id,
                "event_id": event_id,
                "subject": subject,
                "payload": payload,
            });
            writeln!(
                w,
                "{}",
                serde_json::to_string(&line).map_err(|e| e.to_string())?
            )
            .map_err(|e| e.to_string())?;
        }
        w.flush().map_err(|e| e.to_string())?;
        w.get_ref()
            .sync_all()
            .map_err(|e| format!("wal fsync: {e}"))?;
        Ok(())
    }

    /// After JetStream ack: durable mark so startup replay skips this `event_id`.
    pub fn append_ack(&self, event_id: usize) -> Result<(), String> {
        let line = serde_json::json!({
            "t": "ack",
            "v": WAL_VERSION,
            "event_id": event_id,
        });
        let mut w = self.writer.lock();
        writeln!(
            w,
            "{}",
            serde_json::to_string(&line).map_err(|e| e.to_string())?
        )
        .map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
        w.get_ref()
            .sync_all()
            .map_err(|e| format!("wal ack fsync: {e}"))?;
        Ok(())
    }

    /// Scan journal for `evt` rows for `engine_id` with no later `ack` for that `event_id`.
    pub fn scan_unacked_for_engine(engine_id: &str, path: &Path) -> Result<Vec<WalPendingEvent>, String> {
        let f = File::open(path).map_err(|e| format!("wal scan open {}: {e}", path.display()))?;
        let reader = BufReader::new(f);
        let mut pending: BTreeMap<usize, WalPendingEvent> = BTreeMap::new();
        let mut acked: HashSet<usize> = HashSet::new();

        for (lineno, line) in reader.lines().enumerate() {
            let line = line.map_err(|e| format!("wal read line {}: {e}", lineno + 1))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(x) => x,
                Err(_) => continue,
            };
            match v.get("t").and_then(|t| t.as_str()) {
                Some("ack") => {
                    if let Some(id) = v.get("event_id").and_then(|x| x.as_u64()) {
                        acked.insert(id as usize);
                    }
                }
                Some("evt") => {
                    if let Ok(evt) = serde_json::from_value::<WalEvtLine>(v) {
                        if evt.engine_id == engine_id {
                            pending.insert(
                                evt.event_id,
                                WalPendingEvent {
                                    event_id: evt.event_id,
                                    subject: evt.subject,
                                    event: evt.payload,
                                },
                            );
                        }
                    }
                }
                _ => {}
            }
        }

        let mut out: Vec<WalPendingEvent> = pending
            .into_iter()
            .filter(|(id, _)| !acked.contains(id))
            .map(|(_, v)| v)
            .collect();
        out.sort_by_key(|e| e.event_id);
        Ok(out)
    }

    /// Rewrite the journal to **only** unacked `evt` lines (drops ack lines and fully-acked evts).
    /// Call **before** `open_resolved` while no writer holds the file.
    pub fn compact_journal_keep_unacked_only(engine_id: &str, path: &Path) -> Result<(), String> {
        let pending = Self::scan_unacked_for_engine(engine_id, path)?;
        let tmp = path.with_extension("jsonl.compact.tmp");
        {
            let f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&tmp)
                .map_err(|e| format!("wal compact tmp {}: {e}", tmp.display()))?;
            let mut w = BufWriter::new(f);
            for row in &pending {
                let payload = serde_json::to_value(&row.event).map_err(|e| e.to_string())?;
                let line = serde_json::json!({
                    "t": "evt",
                    "v": WAL_VERSION,
                    "engine_id": engine_id,
                    "event_id": row.event_id,
                    "subject": row.subject,
                    "payload": payload,
                });
                writeln!(
                    w,
                    "{}",
                    serde_json::to_string(&line).map_err(|e| e.to_string())?
                )
                .map_err(|e| e.to_string())?;
            }
            w.flush().map_err(|e| e.to_string())?;
            w.get_ref()
                .sync_all()
                .map_err(|e| format!("wal compact fsync: {e}"))?;
        }
        std::fs::rename(&tmp, path).map_err(|e| format!("wal compact rename: {e}"))?;
        eprintln!(
            "[engine] WAL compacted {} → {} unacked evt line(s)",
            path.display(),
            pending.len()
        );
        Ok(())
    }
}
