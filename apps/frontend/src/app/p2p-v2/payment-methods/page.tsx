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
  Shield, Copy, Check,
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

  const inputCls = 'w-full rounded-lg border border-border/40 bg-background px-3.5 py-2.5 text-[13px] text-foreground transition-colors focus:border-primary/40 focus:outline-none';
  const labelCls = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60';

  const canSubmit = platformId && formFields.filter((f) => f.required).every((f) => fields[f.key]?.trim());

  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 py-3">
        <div>
          <h1 className="text-[15px] font-bold text-foreground">Payment Methods</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Manage payment methods for P2P trading</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Method
          </button>
        )}
      </div>

      {/* Add form (expandable) */}
      {showForm && (
        <div className="mt-4 rounded-lg border border-primary/20 bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/20 px-5 py-3">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Plus className="h-3.5 w-3.5 text-primary" />
              Add Payment Method
            </h2>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Step 1: Select type */}
            <div>
              <label className={labelCls}>Payment Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {platform.map((p) => {
                  const Icon = getMethodIcon(p.code);
                  const selected = platformId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPlatformId(p.id);
                        setFields({});
                      }}
                      className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all ${
                        selected
                          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border/30 hover:border-border/50 hover:bg-muted/10'
                      }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        selected ? 'bg-primary/15 text-primary' : 'bg-muted/30 text-muted-foreground'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-[12px] font-medium truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {p.name}
                        </p>
                        {p.code && <p className="text-[10px] text-muted-foreground/50">{p.code}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Fields (shown when type selected) */}
            {platformId && (
              <>
                <div className="border-t border-border/15 pt-4">
                  <label className={labelCls}>Display Name (optional)</label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={`e.g. My ${selectedPlatform?.name ?? 'Payment'} Account`}
                    className={inputCls}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {formFields.map((f) => (
                    <div key={f.key}>
                      <label className={labelCls}>
                        {f.label}
                        {f.required && <span className="text-[#f6465d] ml-0.5">*</span>}
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
                  <div className="rounded-md bg-[#f6465d]/5 border border-[#f6465d]/15 px-3 py-2 text-[12px] text-[#f6465d]">{err}</div>
                )}

                <div className="flex items-center gap-3 border-t border-border/15 pt-4">
                  <button
                    type="button"
                    disabled={!canSubmit || addMut.isPending}
                    onClick={() => { setErr(null); addMut.mutate(); }}
                    className="rounded-lg bg-primary px-6 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                  >
                    {addMut.isPending ? 'Adding…' : 'Add Method'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); resetForm(); }}
                    className="rounded-lg px-4 py-2.5 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                    <Shield className="h-3 w-3" />
                    Encrypted & secure
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Methods list */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold text-foreground">
            Your Methods
            {!isLoading && <span className="ml-2 rounded-md bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">{list.length}</span>}
          </h2>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border/20 p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-6 w-14 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && list.length === 0 && (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border/30 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/20 mb-3">
              <CreditCard className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-[13px] font-medium text-foreground">No payment methods yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
              Add a payment method to start buying and selling on P2P. Your details are encrypted and only shared with trade counterparties.
            </p>
            {!showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Method
              </button>
            )}
          </div>
        )}

        {/* Method cards */}
        {!isLoading && list.length > 0 && (
          <div className="space-y-2">
            {list.map((m) => {
              const isActive = (m as { is_active?: boolean }).is_active !== false;
              const details = (m as { payment_details?: Record<string, unknown> }).payment_details;
              const isExpanded = expandedId === m.id;
              const Icon = getMethodIcon(m.method_code);
              const detailEntries = details ? Object.entries(details).filter(([, v]) => v != null && String(v).trim() !== '') : [];

              return (
                <div
                  key={m.id}
                  className={`rounded-lg border transition-all ${
                    isActive ? 'border-border/30 bg-card' : 'border-border/15 bg-card/50'
                  }`}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-3 p-4">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      isActive ? 'bg-primary/10 text-primary' : 'bg-muted/20 text-muted-foreground/50'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-[13px] font-medium truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {m.display_name || m.method_name}
                        </p>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                          isActive ? 'bg-[#0ecb81]/10 text-[#0ecb81]' : 'bg-muted/40 text-muted-foreground'
                        }`}>
                          {isActive ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        {m.method_name}{m.method_code ? ` · ${m.method_code}` : ''}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {detailEntries.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : m.id)}
                          className="rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleMut.mutate({ id: m.id, active: !isActive })}
                        className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                          isActive
                            ? 'text-amber-500 hover:bg-amber-500/10'
                            : 'text-[#0ecb81] hover:bg-[#0ecb81]/10'
                        }`}
                      >
                        {isActive ? (
                          <span className="flex items-center gap-1"><ToggleRight className="h-3.5 w-3.5" /> Disable</span>
                        ) : (
                          <span className="flex items-center gap-1"><ToggleLeft className="h-3.5 w-3.5" /> Enable</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm('Remove this payment method permanently?')) delMut.mutate(m.id); }}
                        className="rounded-md p-1.5 text-[#f6465d]/60 transition-colors hover:bg-[#f6465d]/10 hover:text-[#f6465d]"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && detailEntries.length > 0 && (
                    <div className="border-t border-border/15 px-4 py-3 bg-muted/[0.02]">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {detailEntries.map(([k, v]) => {
                          const val = String(v);
                          const copyId = `${m.id}-${k}`;
                          return (
                            <div key={k} className="flex items-start justify-between gap-2 rounded-md bg-background/50 border border-border/10 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{formatLabel(k)}</p>
                                <p className="text-[12px] font-mono text-foreground mt-0.5 break-all">{val}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyValue(copyId, val)}
                                className="shrink-0 rounded-md p-1 text-muted-foreground/40 hover:text-foreground hover:bg-muted/20"
                                title="Copy"
                              >
                                {copiedKey === copyId
                                  ? <Check className="h-3 w-3 text-[#0ecb81]" />
                                  : <Copy className="h-3 w-3" />
                                }
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
      </div>
    </div>
  );
}
