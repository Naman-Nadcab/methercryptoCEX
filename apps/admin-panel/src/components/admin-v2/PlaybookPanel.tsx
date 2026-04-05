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
      <div className="flex items-center gap-2 text-xs text-admin-muted">
        <BookOpen className="w-3.5 h-3.5" />
        <span className="font-medium">Suggested Playbooks</span>
      </div>

      {playbooks.map((pb) => (<PlaybookCard key={pb.id} playbook={pb} />))}
    </div>
  );
}

export const PlaybookPanel = memo(PlaybookPanelInner);

const PlaybookCard = memo(function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const immediateSteps = playbook.steps.filter((s) => s.priority === 'immediate');
  const followUpSteps = playbook.steps.filter((s) => s.priority === 'follow-up');

  return (
    <div className="rounded-lg border border-admin-border bg-white/[0.02] overflow-hidden">
      <div className="px-3 py-2 border-b border-admin-border/60 flex items-center gap-2">
        <BookOpen className="w-3 h-3 text-blue-600" />
        <span className="text-xs font-medium text-blue-600">{playbook.title}</span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {immediateSteps.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-red-600 font-semibold uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5" /> Immediate
            </div>
            {immediateSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-admin-text pl-1">
                <ArrowRight className="w-3 h-3 text-admin-muted mt-0.5 shrink-0" />
                <span>{step.action}</span>
              </div>
            ))}
          </div>
        )}

        {followUpSteps.length > 0 && (
          <div className="space-y-1 pt-1.5 border-t border-admin-border/40">
            <div className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold uppercase tracking-wider">
              <Clock className="w-2.5 h-2.5" /> Follow-up
            </div>
            {followUpSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-admin-muted pl-1">
                <ArrowRight className="w-3 h-3 text-admin-muted mt-0.5 shrink-0" />
                <span>{step.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
