/**
 * Audit Integration — Production Hardening Layer (STEP 2)
 *
 * Non-invasive hooks that subscribe to existing stores and automatically
 * log actions to the audit trail. Does NOT modify any core logic.
 *
 * Usage: Call useAuditIntegration() once in the Dashboard component.
 */

'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAdminAuditLog } from '@/store/adminAuditLog';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';

export function useAuditIntegration() {
  const logAction = useAdminAuditLog((s) => s.logAction);
  const trackPageVisit = useAdminAuditLog((s) => s.trackPageVisit);
  const pathname = usePathname();

  const alerts = useAdminAlertStore((s) => s.alerts);
  const incidents = useAdminIncidentStore((s) => s.incidents);

  const prevAlertCountRef = useRef(alerts.length);
  const prevIncidentSnapshotRef = useRef<string>('');
  const hasLoggedSessionRef = useRef(false);

  useEffect(() => {
    if (!ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING) return;
    if (!hasLoggedSessionRef.current) {
      logAction('session_started', { userAgent: navigator.userAgent, path: pathname });
      hasLoggedSessionRef.current = true;
    }
  }, [logAction, pathname]);

  useEffect(() => {
    if (!ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING) return;
    trackPageVisit(pathname);
  }, [pathname, trackPageVisit]);

  useEffect(() => {
    if (!ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING) return;

    const snapshot = incidents.map((i) => `${i.id}:${i.status}`).join(',');
    if (snapshot === prevIncidentSnapshotRef.current) return;

    const prevSnap = prevIncidentSnapshotRef.current;
    prevIncidentSnapshotRef.current = snapshot;

    if (!prevSnap) return;

    const prevMap = new Map<string, string>();
    for (const part of prevSnap.split(',')) {
      const [id, status] = part.split(':');
      if (id && status) prevMap.set(id, status);
    }

    for (const inc of incidents) {
      const prevStatus = prevMap.get(inc.id);
      if (!prevStatus && inc.status === 'active') {
        logAction('incident_created', { incidentId: inc.id, title: inc.title, severity: inc.severity });
      } else if (prevStatus && prevStatus !== inc.status) {
        if (inc.status === 'acknowledged') {
          logAction('incident_acknowledged', { incidentId: inc.id, acknowledgedBy: inc.acknowledgedBy });
        } else if (inc.status === 'investigating') {
          logAction('incident_investigating', { incidentId: inc.id });
        } else if (inc.status === 'resolved') {
          logAction('incident_resolved', {
            incidentId: inc.id,
            duration: inc.resolvedAt && inc.startedAt ? inc.resolvedAt - inc.startedAt : undefined,
          });
        }
      }
    }
  }, [incidents, logAction]);
}
