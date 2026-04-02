# Runbook: WebSocket failures and reconnect storms

**Symptoms:** `SpotWsDisconnectSpike`, `SpotWsChurnElevated`, or `SpotWsForwarderSheddingActive` / high drop rates; clients report stale tickers or books while REST still works.

## Principles

- **Public WS is not the fund ledger.** Trading correctness depends on REST/engine/settlement paths; WS issues are primarily availability and UX.
- Still treat **shedding and drops** as serious: operators need visibility and capacity fixes.

## Steps

1. **Metrics**  
   Inspect `spot_ws_disconnects_total` rate, `spot_ws_forwarder_mode`, `spot_ws_forwarder_messages_dropped_total`, and orderbook writer lag (stale books correlate with writer issues).

2. **Infrastructure**  
   Check load balancer / proxy **idle timeouts** (must exceed client ping interval). Review recent deploys or config pushes.

3. **NATS / forwarder**  
   If forwarder is shedding, reduce fan-out load or add capacity; see alerts annotations in `spot-tier1.rules.yml`.

4. **Client behavior**  
   Reconnect storms can amplify load; consider rate limits and exponential backoff on client side (document for API consumers).

5. **Engine / settlement**  
   If WS is bad but orders fail too, escalate to [engine-down.md](./engine-down.md) and settlement runbooks — do not assume WS-only.

6. **Post-incident**  
   Note peak disconnect rate, duration, and whether orderbook writer lag stayed within SLO.
