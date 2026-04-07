'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import {
  fetchMyPaymentMethods,
  fetchPlatformPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  P2P_PAYMENT_METHODS_QUERY_KEY,
  type PlatformPaymentMethod,
} from '@/lib/p2pApi';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  CreditCard, Plus, ToggleLeft, ToggleRight, Trash2,
  ChevronDown, ChevronUp, X, Building2, Smartphone, Banknote,
  Shield, Copy, Check, ListChecks, Lock, Sparkles,
} from 'lucide-react';

/* ── Structured field templates per method code ── */
type FieldDef = { key: string; label: string; placeholder: string; required?: boolean };

const FIELD_MAP: Record<string, FieldDef[]> = {
  bank_transfer: [
    { key: 'account_name', label: 'Account Holder Name', placeholder: 'Full name as on bank account', required: true },
    { key: 'bank_name', label: 'Bank Name', placeholder: 'e.g. State Bank of India', required: true },
    { key: 'account_number', label: 'Account Number', placeholder: 'Bank account number', required: true },
    { key: 'ifsc', label: 'IFSC Code', placeholder: 'e.g. SBIN0001234', required: true },
  ],
  bank: [
    { key: 'account_name', label: 'Account Holder Name', placeholder: 'Full name', required: true },
    { key: 'bank_name', label: 'Bank Name', placeholder: 'Bank name', required: true },
    { key: 'account_number', label: 'Account Number', placeholder: 'Account number', required: true },
    { key: 'ifsc', label: 'IFSC / Routing Code', placeholder: 'IFSC or routing code', required: true },
  ],
  upi: [
    { key: 'account_name', label: 'Name', placeholder: 'Name linked to UPI', required: true },
    { key: 'upi_id', label: 'UPI ID', placeholder: 'e.g. yourname@upi', required: true },
  ],
  imps: [
    { key: 'account_name', label: 'Account Holder Name', placeholder: 'Full name', required: true },
    { key: 'bank_name', label: 'Bank Name', placeholder: 'Bank name', required: true },
    { key: 'account_number', label: 'Account Number', placeholder: 'Account number', required: true },
    { key: 'ifsc', label: 'IFSC Code', placeholder: 'IFSC code', required: true },
  ],
  wire: [
    { key: 'account_name', label: 'Beneficiary Name', placeholder: 'Full legal name', required: true },
    { key: 'bank_name', label: 'Bank Name', placeholder: 'Bank or institution', required: true },
    { key: 'account_number', label: 'Account / IBAN', placeholder: 'Account number or IBAN', required: true },
    { key: 'swift', label: 'SWIFT / BIC', placeholder: 'SWIFT code', required: true },
  ],
};

const DEFAULT_FIELDS: FieldDef[] = [
  { key: 'account_name', label: 'Account Holder Name', placeholder: 'Full name', required: true },
  { key: 'bank_name', label: 'Bank / Institution', placeholder: 'Bank or payment provider' },
  { key: 'account_number', label: 'Account Number / ID', placeholder: 'Account number or identifier', required: true },
  { key: 'ifsc', label: 'IFSC / Routing / SWIFT', placeholder: 'Routing code' },
];

function getFieldsForCode(code: string | undefined): FieldDef[] {
  if (!code) return DEFAULT_FIELDS;
  const lc = code.toLowerCase();
  for (const [k, v] of Object.entries(FIELD_MAP)) {
    if (lc.includes(k)) return v;
  }
  return DEFAULT_FIELDS;
}

const METHOD_ICONS: Record<string, typeof Building2> = {
  bank: Building2,
  upi: Smartphone,
  imps: Banknote,
  wire: Building2,
};

function getMethodIcon(code: string | undefined) {
  if (!code) return CreditCard;
  const lc = code.toLowerCase();
  for (const [k, v] of Object.entries(METHOD_ICONS)) {
    if (lc.includes(k)) return v;
  }
  return CreditCard;
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Main page ── */
export default function P2PV2PaymentMethodsPage() {
  return <RequireAuth><PmInner /></RequireAuth>;
}

function PmInner() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [platformId, setPlatformId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: P2P_PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => fetchMyPaymentMethods({ includeInactive: true }),
  });

  const { data: platform = [] } = useQuery({
    queryKey: ['p2p-v2', 'platform-pm'],
    queryFn: fetchPlatformPaymentMethods,
  });

  const selectedPlatform = useMemo(
    () => platform.find((p) => p.id === platformId),
    [platform, platformId],
  );

  const formFields = useMemo(
    () => getFieldsForCode(selectedPlatform?.code),
    [selectedPlatform],
  );

  const resetForm = () => {
    setPlatformId(''); setDisplayName(''); setFields({}); setErr(null);
  };

  const addMut = useMutation({
    mutationFn: () => {
      const details: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v.trim()) details[k] = v.trim();
      }
      return addPaymentMethod({
        payment_method_id: platformId,
        display_name: displayName.trim() || undefined,
        payment_details: details,
      });
    },
    onSuccess: (res) => {
      if (res.success) {
        qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY });
        resetForm();
        setShowForm(false);
      } else { setErr(res.error?.message ?? 'Add failed'); }
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updatePaymentMethod(id, { is_active: active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deletePaymentMethod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY }),
  });

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch { /* ignore */ }
  };

  const inputCls =
    'w-full rounded-xl border border-border/40 bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';
  const labelCls = 'mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  const canSubmit = platformId && formFields.filter((f) => f.required).every((f) => fields[f.key]?.trim());

  const { activeCount, disabledCount } = useMemo(() => {
    let active = 0;
    let disabled = 0;
    for (const row of list) {
      const on = (row as { is_active?: boolean }).is_active !== false;
      if (on) active += 1;
      else disabled += 1;
    }
    return { activeCount: active, disabledCount: disabled };
  }, [list]);

  return (
    <div className="relative min-h-[min(70vh,720px)] w-full">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[min(420px,50vh)] bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-[1100px] px-4 pb-12 sm:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-border/25 py-5 sm:flex-row sm:items-end sm:justify-between sm:py-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90 sm:text-xs">
            P2P · Payments
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Payment methods</h1>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Add how you receive fiat for P2P trades. Details stay private until you match with a counterparty.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add method
          </button>
        )}
      </header>

      {/* Summary strip (when list loaded & non-empty) */}
      {!isLoading && list.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/35 bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm sm:text-sm">
            <span className="tabular-nums font-semibold text-primary">{activeCount}</span>
            <span className="text-muted-foreground">active</span>
          </span>
          {disabledCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/30 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:text-sm">
              <span className="tabular-nums font-semibold text-foreground">{disabledCount}</span>
              disabled
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/25 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground sm:text-sm">
            <Lock className="h-3.5 w-3.5 shrink-0 text-primary/70" />
            Shown only during active trades
          </span>
        </div>
      )}

      {/* Add form (expandable) */}
      {showForm && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-md ring-1 ring-primary/10">
          <div className="flex items-center justify-between gap-3 border-b border-border/20 bg-muted/20 px-5 py-4 sm:px-6">
            <h2 className="flex items-center gap-2.5 text-base font-semibold text-foreground">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </span>
              Add payment method
            </h2>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              aria-label="Close form"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            {/* Step 1: Select type */}
            <div>
              <label className={labelCls} id="pm-type-label">
                Payment type
              </label>
              <p className="mb-3 text-sm text-muted-foreground">Choose how buyers will send you fiat.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {platform.map((p) => {
                  const Icon = getMethodIcon(p.code);
                  const selected = platformId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={selected}
                      aria-labelledby="pm-type-label"
                      title={p.code ? `${p.name} (${p.code})` : p.name}
                      onClick={() => {
                        setPlatformId(p.id);
                        setFields({});
                      }}
                      className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-all duration-150 ${
                        selected
                          ? 'border-primary/50 bg-primary/8 shadow-sm ring-2 ring-primary/20'
                          : 'border-border/40 bg-card/50 hover:border-border/60 hover:bg-muted/20 hover:shadow-sm'
                      }`}
                    >
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                          selected ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-base font-semibold leading-snug ${selected ? 'text-foreground' : 'text-foreground/90'}`}>
                          {p.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Fields (shown when type selected) */}
            {platformId && (
              <>
                <div className="border-t border-border/20 pt-6">
                  <label className={labelCls}>Display name (optional)</label>
                  <p className="mb-2 text-sm text-muted-foreground">Shown to you in the list — not required.</p>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={`e.g. My ${selectedPlatform?.name ?? 'payment'} account`}
                    className={inputCls}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {formFields.map((f) => (
                    <div key={f.key}>
                      <label className={labelCls}>
                        {f.label}
                        {f.required && <span className="ml-0.5 text-[#f6465d]">*</span>}
                      </label>
                      <input
                        value={fields[f.key] ?? ''}
                        onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>

                {err && (
                  <div className="rounded-xl border border-[#f6465d]/20 bg-[#f6465d]/5 px-4 py-3 text-sm font-medium text-[#f6465d]">
                    {err}
                  </div>
                )}

                <div className="flex flex-col gap-4 border-t border-border/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={!canSubmit || addMut.isPending}
                      onClick={() => { setErr(null); addMut.mutate(); }}
                      className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      {addMut.isPending ? 'Adding…' : 'Save method'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowForm(false); resetForm(); }}
                      className="rounded-xl border border-border/50 px-5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4 shrink-0 text-primary/80" />
                    Encrypted in transit
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Methods list + sidebar */}
      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] lg:items-start lg:gap-8 xl:gap-10">
        <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Your methods
              {!isLoading && (
                <span className="ml-2 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-muted/50 px-2 text-xs font-bold text-muted-foreground">
                  {list.length}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage payout accounts for P2P orders. Expand a row to copy details when you need them.
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/25 p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-11 w-11 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3.5 w-28" />
                  </div>
                  <Skeleton className="h-9 w-24 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && list.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border/40 bg-muted/[0.08] py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/30 bg-card">
              <CreditCard className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-semibold text-foreground">No payment methods yet</p>
            <p className="mt-2 max-w-md px-4 text-sm leading-relaxed text-muted-foreground">
              Add at least one way to receive fiat so you can publish ads and take trades. Details are encrypted and only shown to your counterparty during an order.
            </p>
            {!showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add method
              </button>
            )}
          </div>
        )}

        {/* Method cards */}
        {!isLoading && list.length > 0 && (
          <div className="space-y-3">
            {list.map((m) => {
              const isActive = (m as { is_active?: boolean }).is_active !== false;
              const details = (m as { payment_details?: Record<string, unknown> }).payment_details;
              const isExpanded = expandedId === m.id;
              const Icon = getMethodIcon(m.method_code);
              const detailEntries = details ? Object.entries(details).filter(([, v]) => v != null && String(v).trim() !== '') : [];
              const titleLine = m.display_name || m.method_name;
              const subtitle =
                m.display_name && m.method_name && m.display_name !== m.method_name ? m.method_name : null;
              const updatedRaw = (m as { updated_at?: string; created_at?: string }).updated_at
                ?? (m as { created_at?: string }).created_at;
              let updatedLabel: string | null = null;
              if (updatedRaw) {
                const d = new Date(updatedRaw);
                if (!Number.isNaN(d.getTime())) {
                  updatedLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                }
              }

              return (
                <div
                  key={m.id}
                  title={m.method_code || undefined}
                  className={`overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 ${
                    isActive
                      ? 'border-border/40 bg-card hover:border-primary/25 hover:shadow-md'
                      : 'border-border/20 bg-card/60 opacity-95 hover:border-border/40 hover:shadow-sm'
                  }`}
                >
                  {/* Main row */}
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-border/20 ${
                          isActive ? 'bg-primary/12 text-primary' : 'bg-muted/30 text-muted-foreground'
                        }`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`truncate text-base font-semibold ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {titleLine}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              isActive ? 'bg-[#0ecb81]/12 text-[#0ecb81] ring-1 ring-[#0ecb81]/20' : 'bg-muted/50 text-muted-foreground'
                            }`}
                          >
                            {isActive ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:text-xs">
                            <Lock className="h-3 w-3 shrink-0" />
                            Private until trade
                          </span>
                          {updatedLabel && (
                            <span className="text-[11px] text-muted-foreground/80 sm:text-xs">Updated {updatedLabel}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:pl-2">
                      {detailEntries.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : m.id)}
                          className="inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-xl border border-border/40 text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleMut.mutate({ id: m.id, active: !isActive })}
                        className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'border-amber-500/30 text-amber-500 hover:bg-amber-500/10'
                            : 'border-[#0ecb81]/30 text-[#0ecb81] hover:bg-[#0ecb81]/10'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <ToggleRight className="h-4 w-4" />
                            Disable
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="h-4 w-4" />
                            Enable
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Remove this payment method permanently?')) delMut.mutate(m.id);
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 text-[#f6465d]/70 transition-colors hover:border-[#f6465d]/40 hover:bg-[#f6465d]/10 hover:text-[#f6465d]"
                        title="Delete"
                        aria-label="Delete payment method"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && detailEntries.length > 0 && (
                    <div className="border-t border-border/20 bg-muted/[0.06] px-4 py-4 sm:px-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account details</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {detailEntries.map(([k, v]) => {
                          const val = String(v);
                          const copyId = `${m.id}-${k}`;
                          return (
                            <div
                              key={k}
                              className="flex items-start justify-between gap-3 rounded-xl border border-border/25 bg-background/80 px-3.5 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatLabel(k)}</p>
                                <p className="numeric mt-1 break-all text-sm text-foreground">{val}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyValue(copyId, val)}
                                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                title="Copy"
                              >
                                {copiedKey === copyId ? (
                                  <Check className="h-4 w-4 text-[#0ecb81]" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Backup method prompt */}
        {!isLoading && list.length > 0 && list.length < 4 && !showForm && (
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Add a backup method</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  A second payout option helps if one bank or app is down during a trade.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/35 bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40"
            >
              <Plus className="h-4 w-4" />
              Add another
            </button>
          </div>
        )}
        </div>

        {/* Tips sidebar (desktop sticky; stacks below list on small screens) */}
        <aside className="mt-10 space-y-4 lg:mt-8 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-border/35 bg-card/90 p-4 shadow-sm ring-1 ring-border/10 backdrop-blur-sm sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListChecks className="h-4 w-4 text-primary" />
              Before you trade
            </div>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                Use the legal name that matches your bank or UPI KYC.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                Double-check account numbers and IFSC — buyers pay to these details.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                Disable a method instead of deleting it if you might use it again.
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border/30 bg-muted/[0.12] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Shield className="h-4 w-4 text-primary/90" />
              Security
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Payout details are sent over TLS. They are only visible to your counterparty while an order is active — not on the public marketplace.
            </p>
          </div>
        </aside>
      </div>
      </div>
    </div>
  );
}
