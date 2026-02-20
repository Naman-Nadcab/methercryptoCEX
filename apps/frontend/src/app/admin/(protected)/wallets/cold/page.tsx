'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  ActionButton,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
} from '@/components/admin/control-plane';
import { Loader2, RefreshCw, Shield } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ColdRow {
  chainId: string;
  chainName: string;
  coldWalletAddress: string | null;
}

function truncateAddress(addr: string | null, len = 8): string {
  if (!addr) return '—';
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}

export default function ColdWalletsPage() {
  const { accessToken } = useAdminAuthStore();
  const [rows, setRows] = useState<ColdRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCold = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hot-wallets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (!result?.success || !Array.isArray(result.data)) {
        setRows([]);
        return;
      }
      const list: ColdRow[] = result.data.map((w: Record<string, unknown>) => ({
        chainId: String(w.chainId ?? w.chain_id ?? ''),
        chainName: String(w.chainName ?? w.chain_name ?? '—'),
        coldWalletAddress: w.coldWalletAddress != null ? String(w.coldWalletAddress) : (w.cold_wallet_address != null ? String(w.cold_wallet_address) : null),
      }));
      setRows(list);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchCold();
  }, [fetchCold]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Cold Storage"
        subtitle="Cold wallet (sweep target) per chain. Configure in Hot Wallet settings for each chain."
        action={
          <ActionButton icon={<RefreshCw className="w-4 h-4" />} onClick={fetchCold} loading={loading} variant="secondary">
            Refresh
          </ActionButton>
        }
      />

      <DataTableContainer
        title="Cold wallet addresses"
        subtitle={rows.length > 0 ? `${rows.length} chains` : undefined}
        isEmpty={!loading && rows.length === 0}
        emptyMessage="No hot wallets found. Cold addresses are set per hot wallet in Hot Wallet → Settings."
        wrapTable={false}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <>
            <DataTableHead>
              <DataTableTh>Chain</DataTableTh>
              <DataTableTh>Cold wallet address</DataTableTh>
              <DataTableTh align="right">Actions</DataTableTh>
            </DataTableHead>
            <DataTableBody>
              {rows.map((r) => (
                <DataTableRow key={r.chainId}>
                  <DataTableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      {r.chainName}
                    </span>
                  </DataTableCell>
                  <DataTableCell mono className="max-w-[280px] truncate" title={r.coldWalletAddress ?? undefined}>
                    {r.coldWalletAddress ? truncateAddress(r.coldWalletAddress, 12) : '—'}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <Link
                      href={`/admin/wallets/hot/${encodeURIComponent(r.chainId)}`}
                      className="text-sm font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400"
                    >
                      Edit in Hot Wallet
                    </Link>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </>
        )}
      </DataTableContainer>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/10 p-4 text-sm text-blue-900 dark:text-blue-100">
        <p className="font-medium">How cold storage works</p>
        <p className="mt-1 text-blue-800 dark:text-blue-200/90">
          Each hot wallet (per chain) can have one cold wallet address. Withdrawals above the min hot balance are swept to this cold address.
          Set or change the cold address in <strong>Hot / Cold Wallet Monitor</strong> → select chain → <strong>Wallet settings (admin)</strong>.
        </p>
      </div>
    </div>
  );
}
