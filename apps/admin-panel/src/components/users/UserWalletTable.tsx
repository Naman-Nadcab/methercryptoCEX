'use client';

export interface WalletBalanceRow {
  token_symbol: string;
  token_id?: string;
  available_balance: string;
  locked_balance: string;
  total_balance?: string;
  escrow_balance?: string;
}

export interface UserWalletTableProps {
  balances: WalletBalanceRow[];
  isLoading?: boolean;
}

function formatNum(val: string | number | undefined): string {
  if (val === undefined || val === null) return '0';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function UserWalletTable({ balances, isLoading }: UserWalletTableProps) {
  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[400px] border-collapse">
          <thead>
            <tr className="border-b border-admin-border bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Asset</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Available</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Locked</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Escrow</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">Loading…</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] border-collapse">
        <thead>
          <tr className="border-b border-admin-border bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-admin-muted">Asset</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Available</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Locked</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Escrow</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-admin-muted">Total</th>
          </tr>
        </thead>
        <tbody>
          {!balances?.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">No wallets</td>
            </tr>
          ) : (
            balances.map((row, i) => {
              const avail = row.available_balance ?? '0';
              const locked = row.locked_balance ?? '0';
              const escrow = row.escrow_balance ?? '0';
              const total = row.total_balance ?? String(parseFloat(avail) + parseFloat(locked) + parseFloat(escrow));
              return (
                <tr key={row.token_id ?? row.token_symbol ?? i} className="border-b border-admin-border/60 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.token_symbol}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNum(avail)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNum(locked)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNum(escrow)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatNum(total)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
