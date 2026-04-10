/**
 * Invoked by phase1-final-security-verify with env overrides (fresh config parse).
 */
import { effectiveRequiredApprovals } from '../src/services/admin-approval.service.js';

const t = effectiveRequiredApprovals('manual_credit');
process.stdout.write(String(t));
