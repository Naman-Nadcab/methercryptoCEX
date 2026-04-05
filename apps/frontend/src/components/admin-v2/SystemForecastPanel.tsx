'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import {
  BrainCircuit, TrendingUp, Clock, ArrowRight,
  AlertTriangle, ShieldAlert, Gauge, Lightbulb,
} from 'lucide-react';
import type { TrendPrediction } from './useTrendAnalyzer';
import type { Suggestion } from './useSuggestionEngine';

interface SystemForecastPanelProps {
  predictions: TrendPrediction[];
  suggestions: Suggestion[];
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-zinc-500">{pct}%</span>
    </div>
  );
}

const PRIORITY_COLORS = {
  high: 'text-red-400 bg-red-500/10 border-red-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  low: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

function SystemForecastPanelInner({ predictions, suggestions }: SystemForecastPanelProps) {
  const hasPredictions = predictions.length > 0;
  const hasSuggestions = suggestions.length > 0;

  const topPredictions = useMemo(() => predictions.slice(0, 4), [predictions]);
  const topSuggestions = useMemo(() => suggestions.slice(0, 5), [suggestions]);

  return (
    <div className="rounded-xl border border-violet-500/20 bg-[#151922] overflow-hidden transition-all duration-200 hover:border-violet-500/30 hover:shadow-[0_0_20px_-4px_rgba(139,92,246,0.15)]">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-violet-500/10">
            <BrainCircuit className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-400">System Forecast</h3>
            <p className="text-[10px] text-zinc-600 mt-0.5">AI-powered trend analysis</p>
          </div>
        </div>
        {hasPredictions && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5">
            <Gauge className="w-2.5 h-2.5" />
            {predictions.length} prediction{predictions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="px-4 pb-4 space-y-4">
        {/* Predictions */}
        {!hasPredictions ? (
          <div className="text-center py-6">
            <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-emerald-500/40" />
            <p className="text-xs text-zinc-500">All systems stable — no predicted issues</p>
            <p className="text-[10px] text-zinc-700 mt-0.5">Trends are analyzed every refresh cycle</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topPredictions.map((pred, i) => (
              <PredictionCard key={`${pred.type}-${i}`} prediction={pred} />
            ))}
          </div>
        )}

        {/* Suggestions */}
        {hasSuggestions && (
          <div className="space-y-2 pt-2 border-t border-[#1F2937]">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium uppercase tracking-wider">
              <Lightbulb className="w-3 h-3 text-amber-400" />
              Recommended Actions
            </div>
            <div className="space-y-1">
              {topSuggestions.map((sug) => (
                <SuggestionRow key={sug.id} suggestion={sug} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const SystemForecastPanel = memo(SystemForecastPanelInner);

const PredictionCard = memo(function PredictionCard({ prediction }: { prediction: TrendPrediction }) {
  const isCritical = prediction.severity === 'critical';

  return (
    <div className={`rounded-lg border p-3 transition-all duration-200 ${
      isCritical
        ? 'border-red-500/20 bg-red-500/[0.04]'
        : 'border-violet-500/10 bg-violet-500/[0.03]'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {isCritical ? (
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-red-400 shrink-0" />
          ) : (
            <TrendingUp className="w-3.5 h-3.5 mt-0.5 text-violet-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                isCritical ? 'text-red-400' : 'text-violet-400'
              }`}>
                Prediction
              </span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] text-zinc-500">{prediction.metric}</span>
            </div>
            <p className="text-xs text-[#E5E7EB] leading-relaxed mt-0.5">{prediction.message}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          ~{prediction.timeHorizon}
        </div>
      </div>
      <div className="mt-2">
        {confidenceBar(prediction.confidence)}
      </div>
    </div>
  );
});

const SuggestionRow = memo(function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  return (
    <Link
      href={suggestion.action}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[#1F2937]/50 bg-[#0F1117]/40 hover:bg-white/[0.03] hover:border-zinc-700 transition-all duration-150 group"
    >
      <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_COLORS[suggestion.priority]}`}>
        {suggestion.priority}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#E5E7EB] font-medium truncate">{suggestion.label}</p>
        <p className="text-[10px] text-zinc-600 truncate">{suggestion.description}</p>
      </div>
      <ArrowRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
    </Link>
  );
});
