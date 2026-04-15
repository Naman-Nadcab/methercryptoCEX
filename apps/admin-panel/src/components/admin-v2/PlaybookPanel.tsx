'use client';

import { memo } from 'react';
import { getPlaybooksForSources, type Playbook } from './incidentPlaybooks';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

function PlaybookPanelInner({ alertSources }: { alertSources: string[] }) {
  const playbooks = getPlaybooksForSources(alertSources);

  if (playbooks.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-zinc-600">
        No playbooks available for the current alert sources.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {playbooks.map((pb) => (
        <PlaybookCard key={pb.id} playbook={pb} />
      ))}
    </div>
  );
}

export const PlaybookPanel = memo(PlaybookPanelInner);

function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const immediate = playbook.steps.filter((s) => s.priority === 'immediate');
  const followUp = playbook.steps.filter((s) => s.priority === 'follow-up');

  return (
    <div className="rounded-lg border border-[#1F2937] bg-[#0F1117]/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-[#1F2937] bg-white/[0.02]">
        <h4 className="text-xs font-semibold text-[#E5E7EB]">{playbook.title}</h4>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {immediate.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />
            <span className="text-zinc-300">{step.action}</span>
          </div>
        ))}
        {followUp.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className="w-3 h-3 mt-0.5 text-zinc-600 shrink-0" />
            <span className="text-zinc-500">{step.action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
