/**
 * Discrete PID for writer-side WS coalesce / batch scaling.
 * Error = (lag + net_inflation) − setpoint; positive → widen windows (more batching).
 * Anti-windup: integral clamp; output clamp before mapping to multiplier.
 */

import { config } from '../config/index.js';

let lastStepMs = 0;
let integral = 0;
let lastError = 0;

export function stepWsAdaptivePid(processLagMs: number, networkInflationMs: number): number {
  const c = config.wsWriterLocal;
  if (!c.pidEnabled) return 1;
  const now = Date.now();
  const dtSec = Math.min(2, Math.max(0.05, (now - lastStepMs) / 1000 || 0.05));
  lastStepMs = now;

  const pv = processLagMs + networkInflationMs;
  const e = pv - c.pidSetpointLagMs;

  integral += e * dtSec;
  integral = Math.max(-c.pidIntegralMax, Math.min(c.pidIntegralMax, integral));

  const derivative = (e - lastError) / dtSec;
  lastError = e;

  const u = c.pidKp * e + c.pidKi * integral + c.pidKd * derivative;
  const uClamped = Math.max(c.pidUmin, Math.min(c.pidUmax, u));

  const mult = 1 + uClamped;
  return Math.max(c.pidCoalesceMinMult, Math.min(c.pidCoalesceMaxMult, mult));
}

export function resetWsAdaptivePid(): void {
  lastStepMs = 0;
  integral = 0;
  lastError = 0;
}
