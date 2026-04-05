'use client';

import { memo, useCallback, useEffect, useRef } from 'react';
import { AlertOctagon, X, Siren, XCircle } from 'lucide-react';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import type { IncidentSuggestion } from './useIncidentDetector';

interface IncidentPromptProps {
  suggestion: IncidentSuggestion | null;
  onDismiss: () => void;
}

function IncidentPromptInner({ suggestion, onDismiss }: IncidentPromptProps) {
  const createIncident = useAdminIncidentStore((s) => s.createIncident);
  const soundRef = useRef(false);

  useEffect(() => {
    if (suggestion?.shouldTriggerIncident && !soundRef.current) {
      soundRef.current = true;
    }
    if (!suggestion?.shouldTriggerIncident) {
      soundRef.current = false;
    }
  }, [suggestion]);

  const handleStart = useCallback(() => {
    if (!suggestion) return;
    createIncident({
      title: suggestion.title,
      severity: 'critical',
      triggeringAlertIds: suggestion.triggeringAlertIds,
    });
    onDismiss();
  }, [suggestion, createIncident, onDismiss]);

  if (!suggestion?.shouldTriggerIncident) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[90] backdrop-blur-[4px]" onClick={onDismiss} />
      <div className="fixed inset-0 z-[91] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#151922] rounded-xl border border-red-500/40 shadow-[0_0_40px_-8px_rgba(239,68,68,0.3)] overflow-hidden animate-admin-scale-in">
          {/* Red header strip */}
          <div className="bg-gradient-to-r from-red-600/20 via-red-500/15 to-red-600/20 px-5 py-3 flex items-center justify-between border-b border-red-500/20">
            <div className="flex items-center gap-2">
              <Siren className="w-5 h-5 text-red-400 animate-pulse" />
              <span className="text-sm font-semibold text-red-400 uppercase tracking-wider">Incident Detected</span>
            </div>
            <button onClick={onDismiss} className="p-1 rounded hover:bg-white/5 text-zinc-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertOctagon className="w-6 h-6 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-[#E5E7EB] mb-1">
                  Multiple Critical Alerts Detected
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {suggestion.triggeringAlertIds.length} critical alerts fired within 10 seconds.
                  This pattern suggests a systemic issue requiring coordinated response.
                </p>
              </div>
            </div>

            {/* Suggested title */}
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#0F1117] border border-[#1F2937]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Suggested Incident Title</p>
              <p className="text-xs text-[#E5E7EB] font-medium">{suggestion.title}</p>
            </div>

            {/* Alert count */}
            <div className="flex items-center gap-2 mb-5 text-[10px] text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span>{suggestion.triggeringAlertIds.length} triggering alerts</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleStart}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/20 transition-all duration-200 active:scale-[0.98]"
              >
                <Siren className="w-3.5 h-3.5" />
                Start Incident
              </button>
              <button
                onClick={onDismiss}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-zinc-400 border border-[#1F2937] rounded-lg hover:bg-white/5 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Ignore
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export const IncidentPrompt = memo(IncidentPromptInner);
