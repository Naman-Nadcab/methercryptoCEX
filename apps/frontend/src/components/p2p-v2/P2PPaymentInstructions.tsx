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

/**
 * Tier-1: structured payment fields (no raw JSON). Unknown keys shown as secondary rows.
 */
export function P2PPaymentInstructions({ details, displayName }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const accountName = pickString(details, [
    'account_name',
    'accountName',
    'holder_name',
    'holderName',
    'name',
    'beneficiary_name',
    'beneficiaryName',
  ]);
  const bankName = pickString(details, ['bank_name', 'bankName', 'bank', 'institution']);
  const accountNumber = pickString(details, [
    'account_number',
    'accountNumber',
    'account_no',
    'accountNo',
    'upi_id',
    'upiId',
  ]);
  const iban = pickString(details, ['iban', 'IBAN']);
  const routing = pickString(details, [
    'ifsc',
    'IFSC',
    'routing_number',
    'routingNumber',
    'swift',
    'SWIFT',
    'bic',
    'sort_code',
    'sortCode',
  ]);

  const knownKeys = new Set([
    'account_name',
    'accountName',
    'holder_name',
    'holderName',
    'name',
    'beneficiary_name',
    'beneficiaryName',
    'bank_name',
    'bankName',
    'bank',
    'institution',
    'account_number',
    'accountNumber',
    'account_no',
    'accountNo',
    'upi_id',
    'upiId',
    'iban',
    'IBAN',
    'ifsc',
    'routing_number',
    'routingNumber',
    'swift',
    'bic',
    'sort_code',
    'sortCode',
  ]);

  const extras = Object.entries(details).filter(
    ([k, v]) => !knownKeys.has(k) && v != null && String(v).trim() !== ''
  );

  const Row = ({
    label,
    value,
    copyKey,
    mono = true,
  }: {
    label: string;
    value: string;
    copyKey: string;
    mono?: boolean;
  }) => (
    <div className="flex flex-col gap-1 border-b border-gray-100 py-2 last:border-b-0 dark:border-gray-800">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-start justify-between gap-2">
        <span className={`min-w-0 flex-1 break-all text-sm text-foreground ${mono ? 'font-mono' : ''}`}>
          {value || '—'}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => copy(copyKey, value)}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
            title="Copy"
          >
            {copied === copyKey ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-100/50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">Payment safety</p>
          <ul className="list-inside list-disc text-[11px] leading-relaxed opacity-95">
            <li>Do not write &quot;crypto&quot;, &quot;Bitcoin&quot;, or exchange names in the bank transfer note.</li>
            <li>Only release crypto after you confirm the fiat arrived in your account.</li>
          </ul>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Send payment to</h3>
        {displayName ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Method label: <span className="font-medium text-gray-900 dark:text-gray-200">{displayName}</span>
          </p>
        ) : null}
        <div className="rounded-lg border border-gray-200 bg-card px-3 dark:border-gray-700 dark:bg-card">
          <Row label="Account name" value={accountName} copyKey="account_name" mono={false} />
          <Row label="Bank / institution" value={bankName} copyKey="bank" mono={false} />
          <Row label="Account number / UPI" value={accountNumber} copyKey="account" />
          {iban ? <Row label="IBAN" value={iban} copyKey="iban" /> : null}
          <Row label="IFSC / Routing / SWIFT" value={routing} copyKey="routing" />
        </div>
      </div>

      {extras.length > 0 ? (
        <div className="rounded-lg border border-gray-200 bg-background/80 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
          <p className="mb-2 text-[10px] font-semibold uppercase text-gray-500">Additional details</p>
          <dl className="space-y-1 text-xs">
            {extras.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="shrink-0 text-gray-500">{formatKeyLabel(k)}</dt>
                <dd className="min-w-0 break-all font-mono text-gray-800 dark:text-gray-200">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
