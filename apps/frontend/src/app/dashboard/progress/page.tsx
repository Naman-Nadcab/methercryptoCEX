'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Loader2,
  ChevronRight,
  TrendingUp,
  Users,
  Key,
  FileText,
} from 'lucide-react';
import {
  EXCHANGE_PROGRESS_STEPS,
  CATEGORY_LABELS,
  type ProgressStep,
  type StepStatus,
} from '@/data/exchangeProgressSteps';

const STATUS_CONFIG: Record<
  StepStatus,
  { label: string; icon: React.ReactNode; bg: string; text: string }
> = {
  done: {
    label: 'Done',
    icon: <CheckCircle2 className="w-4 h-4" />,
    bg: 'bg-green-500/10 dark:bg-green-500/20',
    text: 'text-green-600 dark:text-green-400',
  },
  in_progress: {
    label: 'In progress',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    bg: 'bg-amber-500/10 dark:bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  pending: {
    label: 'Pending',
    icon: <Circle className="w-4 h-4" />,
    bg: 'bg-gray-200 dark:bg-gray-700',
    text: 'text-gray-500 dark:text-gray-400',
  },
};

const CATEGORY_ICONS: Record<ProgressStep['category'], React.ReactNode> = {
  spot_backend: <TrendingUp className="w-5 h-5" />,
  spot_frontend: <TrendingUp className="w-5 h-5" />,
  p2p_backend: <Users className="w-5 h-5" />,
  p2p_frontend: <Users className="w-5 h-5" />,
  general: <Key className="w-5 h-5" />,
};

function StepRow({ step }: { step: ProgressStep }) {
  const config = STATUS_CONFIG[step.status];
  return (
    <div className="flex items-start gap-3 py-3 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <span className={`flex-shrink-0 mt-0.5 ${config.text}`}>{config.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-white">{step.title}</p>
        {step.titleHindi && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.titleHindi}</p>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{step.description}</p>
        {step.routeOrLocation && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono">
            {step.routeOrLocation}
          </p>
        )}
      </div>
      <span
        className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.bg} ${config.text}`}
      >
        {config.icon}
        {config.label}
      </span>
    </div>
  );
}

export default function ProgressPage() {
  const byCategory = useMemo(() => {
    const map = new Map<ProgressStep['category'], ProgressStep[]>();
    for (const step of EXCHANGE_PROGRESS_STEPS) {
      const list = map.get(step.category) ?? [];
      list.push(step);
      map.set(step.category, list);
    }
    const order: ProgressStep['category'][] = [
      'spot_backend',
      'spot_frontend',
      'p2p_backend',
      'p2p_frontend',
      'general',
    ];
    return order.map((cat) => ({ category: cat, steps: map.get(cat) ?? [] }));
  }, []);

  const counts = useMemo(() => {
    let done = 0;
    let inProgress = 0;
    let pending = 0;
    for (const step of EXCHANGE_PROGRESS_STEPS) {
      if (step.status === 'done') done++;
      else if (step.status === 'in_progress') inProgress++;
      else pending++;
    }
    return { done, inProgress, pending, total: EXCHANGE_PROGRESS_STEPS.length };
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Exchange build progress
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Step-by-step tracker — kya karna hai aur kya ho chuka hai
        </p>

        <div className="flex flex-wrap gap-4 mt-6">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 dark:bg-green-500/20 text-green-700 dark:text-green-300">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold">{counts.done}</span>
            <span className="text-sm">Done</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
            <Loader2 className="w-5 h-5" />
            <span className="font-semibold">{counts.inProgress}</span>
            <span className="text-sm">In progress</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <Circle className="w-5 h-5" />
            <span className="font-semibold">{counts.pending}</span>
            <span className="text-sm">Pending</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700">
            <FileText className="w-5 h-5 text-gray-500" />
            <span className="font-semibold">{counts.total}</span>
            <span className="text-sm">Total steps</span>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {byCategory.map(({ category, steps }) => (
          <section
            key={category}
            className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              {CATEGORY_ICONS[category]}
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {CATEGORY_LABELS[category]}
              </h2>
              <span className="text-sm text-gray-500">
                {steps.filter((s) => s.status === 'done').length} / {steps.length}
              </span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Dashboard
        </Link>
        <Link
          href="/dashboard/spot"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
        >
          Spot Trading
          <ChevronRight className="w-4 h-4" />
        </Link>
        <Link
          href="/dashboard/p2p"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
        >
          P2P Trading
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
