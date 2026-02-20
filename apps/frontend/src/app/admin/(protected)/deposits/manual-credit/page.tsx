'use client';

import { useState } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { ArrowDownToLine, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function ManualCreditPage() {
  const { accessToken } = useAdminAuthStore();
  const [user, setUser] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const amt = parseFloat(amount);
    const reasonTrimmed = reason.trim();
    if (!user.trim() || !currency.trim() || !amount.trim() || isNaN(amt) || amt <= 0) {
      setError('Please provide user (email or ID), currency symbol, and a positive amount.');
      return;
    }
    if (!reasonTrimmed) {
      setError('Reason is required for audit. Provide operator justification (e.g. ticket #, compensation).');
      return;
    }
    setLoading(true);
    const idempotencyKey = generateIdempotencyKey();
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/deposits/manual-credit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          user: user.trim(),
          currency: currency.trim().toUpperCase(),
          amount: amount.trim(),
          reason: reasonTrimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Manual credit failed');
        return;
      }
      if (data.success) {
        setSuccess(`Credited ${data.data?.amount} ${data.data?.currency} to ${data.data?.email ?? user}. This action is logged for audit.`);
        setAmount('');
        setReason('');
      } else {
        setError(data?.error?.message || 'Manual credit failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manual Credit</h1>
        <p className="text-gray-400 text-sm mt-1">
          Credit a user&apos;s funding balance (e.g. support adjustment, compensation). Reason is required and recorded for audit.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-200">
          <p className="font-medium">High-impact action (audit logged)</p>
          <p className="mt-1">This action updates the user&apos;s funding balance. You must provide a reason. Ensure you have verified the request (ticket, proof) before crediting.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 max-w-lg space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">User (email or user ID) *</label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="user@example.com or UUID"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Currency (symbol) *</label>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USDT, USDC, BTC, etc."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Amount *</label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Reason (required for audit) *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Support ticket #123, compensation — operator justification"
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 resize-none"
            required
          />
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg font-medium"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
          Credit balance
        </button>
      </form>
    </div>
  );
}
