/**
 * Client-side CSV export for orders and trades.
 * Binance-level feature: export history for taxes/reporting.
 */

export function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(val: unknown): string {
  if (val == null || val === '') return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type ExportOrder = {
  market: string;
  side: string;
  type?: string;
  price: string | null;
  stop_price?: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
  created_at: string;
};

export function ordersToCsv(orders: ExportOrder[]): string {
  const headers = ['Time', 'Market', 'Side', 'Type', 'Price', 'Stop Price', 'Quantity', 'Filled', 'Status'];
  const rows = orders.map((o) => [
    o.created_at,
    o.market,
    o.side,
    o.type ?? '',
    o.price ?? '',
    o.stop_price ?? '',
    o.quantity,
    o.filled_quantity,
    o.status,
  ]);
  const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
  return csv;
}

export type ExportTrade = {
  market: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string | null;
  created_at: string;
};

export function tradesToCsv(trades: ExportTrade[]): string {
  const headers = ['Time', 'Market', 'Side', 'Price', 'Quantity', 'Fee', 'Fee Asset'];
  const rows = trades.map((t) => [
    t.created_at,
    t.market,
    t.side,
    t.price,
    t.quantity,
    t.fee,
    t.fee_asset ?? '',
  ]);
  const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
  return csv;
}
