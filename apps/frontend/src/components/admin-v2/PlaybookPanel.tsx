'use client';

import { useMemo, memo } from 'react';
import { BookOpen, ArrowRight, Zap, Clock } from 'lucide-react';
import { getPlaybooksForSources, type Playbook } from './incidentPlaybooks';

interface PlaybookPanelProps {
  alertSources: string[];
}

function PlaybookPanelInner({ alertSources }: PlaybookPanelProps) {
  const playbooks = useMemo(() => getPlaybooksForSources(alertSources), [alertSources]);

  if (playbooks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <BookOpen className="w-3.5 h-3.5" />
        <span className="font-medium">Suggested Playbooks</span>
      </div>

      {playbooks.map((pb) => (
        <PlaybookCard key={pb.id} playbook={pb} />
      ))}
    </div>
  );
}

export const PlaybookPanel = memo(PlaybookPanelInner);

const PlaybookCard = memo(function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const immediateSteps = playbook.steps.filter((s) => s.priority === 'immediate');
  const followUpSteps = playbook.steps.filter((s) => s.priority === 'follow-up');

  return (
    <div className="rounded-lg border border-[#1F2937] bg-[#0F1117]/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-[#1F2937]/50 flex items-center gap-2">
        <BookOpen className="w-3 h-3 text-blue-400" />
        <span className="text-xs font-medium text-blue-400">{playbook.title}</span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {immediateSteps.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-red-400 font-semibold uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5" />
              Immediate
            </div>
            {immediateSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-[#E5E7EB] pl-1">
                <ArrowRight className="w-3 h-3 text-zinc-600 mt-0.5 shrink-0" />
                <span>{step.action}</span>
              </div>
            ))}
          </div>
        )}

        {followUpSteps.length > 0 && (
          <div className="space-y-1 pt-1.5 border-t border-[#1F2937]/30">
            <div className="flex items-center gap-1 text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
              <Clock className="w-2.5 h-2.5" />
              Follow-up
            </div>
            {followUpSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-zinc-400 pl-1">
                <ArrowRight className="w-3 h-3 text-zinc-700 mt-0.5 shrink-0" />
                <span>{step.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
