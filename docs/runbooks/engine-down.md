# Runbook: Matching engine stopped or unhealthy

**Symptoms:** Place/cancel failures from API; engine health checks fail; `MatchingEngineUnhealthyError` in logs; rust engine `/health` or snapshot endpoints down.

## Principles

- **Protect funds:** API should reject or queue placement when engine is unhealthy (do not accept orders that cannot be matched safely).
- **No silent balance changes** during recovery; rely on reconciliation and existing settlement pipelines.

## Steps

1. **Verify**  
   From ops host: `GET` engine `/health` and `/engine/snapshot` (if applicable). Check backend `/health` depth for matching engine status.

2. **Traffic**  
   Confirm load balancers or shard routers are not sending traffic to a dead instance. Fail over to healthy replica if active–passive is configured.

3. **Restart**  
   Restart the engine process/container per deployment playbook. Ensure `ENGINE_INSTANCE_ID` and persistence paths (WAL, snapshots) match the intended instance.

4. **Backend sync**  
   After engine is up, confirm match-event consumers and Tier-1 reconciliation eventually report OK. Watch `tier1_*` and settlement lag metrics.

5. **Stuck settlement**  
   If lag spiked during outage, follow [settlement-lag.md](./settlement-lag.md).

6. **Post-incident**  
   Record downtime window, whether any orders were accepted while engine was down (should be none), and reconciliation outcome.
