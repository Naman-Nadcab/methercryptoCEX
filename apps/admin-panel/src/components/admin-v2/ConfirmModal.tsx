'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: string;
  confirmWord?: string;
  variant?: 'warning' | 'critical';
}

export function ConfirmModal({
  open, onClose, onConfirm, title, description,
  confirmWord, variant = 'critical',
}: ConfirmModalProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const canConfirm = confirmWord ? input.trim().toUpperCase() === confirmWord.toUpperCase() : true;

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || loading) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      onClose();
    }
  }, [canConfirm, loading, onConfirm, onClose]);

  if (!open) return null;

  const borderColor = variant === 'critical' ? 'border-red-500/40' : 'border-amber-500/40';
  const btnBg = variant === 'critical'
    ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/20'
    : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-lg shadow-amber-500/20';
  const iconColor = variant === 'critical' ? 'text-red-400' : 'text-amber-400';

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[70] backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4">
        <div className={`w-full max-w-md bg-[#151922] rounded-xl border ${borderColor} shadow-2xl`}>
          <div className="flex items-start gap-3 p-5 pb-3">
            <div className={`p-2 rounded-lg bg-[#0F1117] ${iconColor}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-[#E5E7EB]">{title}</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{description}</p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/5 text-zinc-500">
              <X className="w-4 h-4" />
            </button>
          </div>

          {confirmWord && (
            <div className="px-5 pb-3">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                Type <span className="text-[#E5E7EB] font-bold">{confirmWord}</span> to confirm
              </label>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder={confirmWord}
                className="w-full bg-[#0F1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-[#E5E7EB] placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50 transition-colors font-mono"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 p-5 pt-3">
            <button onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-400 border border-[#1F2937] rounded-lg hover:bg-white/5 transition-colors">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={!canConfirm || loading}
              className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${btnBg}`}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
