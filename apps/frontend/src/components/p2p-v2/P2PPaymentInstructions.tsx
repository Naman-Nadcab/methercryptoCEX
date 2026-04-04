'use client';

import { useState } from 'react';
import { AlertTriangle, Copy, Check } from 'lucide-react';

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function formatKeyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type Props = {
  details: Record<string, unknown>;
  displayName?: string | null;
};

export function P2PPaymentInstructions({ details, displayName }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  const accountName = pickString(details, [
    'account_name', 'accountName', 'holder_name', 'holderName', 'name', 'beneficiary_name', 'beneficiaryName',
  ]);
  const bankName = pickString(details, ['bank_name', 'bankName', 'bank', 'institution']);
  const accountNumber = pickString(details, [
    'account_number', 'accountNumber', 'account_no', 'accountNo', 'upi_id', 'upiId',
  ]);
  const iban = pickString(details, ['iban', 'IBAN']);
  const routing = pickString(details, [
    'ifsc', 'IFSC', 'routing_number', 'routingNumber', 'swift', 'SWIFT', 'bic', 'sort_code', 'sortCode',
  ]);

  const knownKeys = new Set([
    'account_name', 'accountName', 'holder_name', 'holderName', 'name', 'beneficiary_name', 'beneficiaryName',
    'bank_name', 'bankName', 'bank', 'institution',
    'account_number', 'accountNumber', 'account_no', 'accountNo', 'upi_id', 'upiId',
    'iban', 'IBAN',
    'ifsc', 'routing_number', 'routingNumber', 'swift', 'bic', 'sort_code', 'sortCode',
  ]);

  const extras = Object.entries(details).filter(
    ([k, v]) => !knownKeys.has(k) && v != null && String(v).trim() !== '',
  );

  const Row = ({ label, value, copyKey, mono = true }: { label: string; value: string; copyKey: string; mono?: boolean }) => (
    <div className="flex flex-col gap-1 border-b border-border/15 py-2.5 last:border-b-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <div className="flex items-start justify-between gap-2">
        <span className={`min-w-0 flex-1 break-all text-[13px] text-foreground ${mono ? 'font-mono' : 'font-medium'}`}>
          {value || '—'}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => copy(copyKey, value)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            title="Copy"
          >
            {copied === copyKey ? <Check className="h-3.5 w-3.5 text-[#0ecb81]" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-4">
      <div className="flex gap-2 rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">Payment Safety</p>
          <ul className="list-inside list-disc text-[10px] leading-relaxed opacity-80">
            <li>Do not write &quot;crypto&quot;, &quot;Bitcoin&quot;, or exchange names in the bank transfer note.</li>
            <li>Only release crypto after you confirm the fiat arrived in your account.</li>
          </ul>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-foreground">Send Payment To</h3>
        {displayName && (
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Method: <span className="font-semibold text-foreground">{displayName}</span>
          </p>
        )}
        <div className="rounded-lg border border-border/25 bg-card px-3.5">
          <Row label="Account Name" value={accountName} copyKey="account_name" mono={false} />
          <Row label="Bank / Institution" value={bankName} copyKey="bank" mono={false} />
          <Row label="Account Number / UPI" value={accountNumber} copyKey="account" />
          {iban && <Row label="IBAN" value={iban} copyKey="iban" />}
          <Row label="IFSC / Routing / SWIFT" value={routing} copyKey="routing" />
        </div>
      </div>

      {extras.length > 0 && (
        <div className="rounded-md border border-border/20 bg-muted/10 px-3.5 py-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Additional Details</p>
          <dl className="space-y-1 text-[11px]">
            {extras.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="shrink-0 text-muted-foreground">{formatKeyLabel(k)}</dt>
                <dd className="min-w-0 break-all font-mono text-foreground">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
