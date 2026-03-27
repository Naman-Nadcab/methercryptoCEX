/**
 * Standard export format for admin tables.
 * All table exports use: timestamp, type, service, admin, details.
 */
export interface StandardExportRow {
  timestamp: string;
  type: string;
  service: string;
  admin: string;
  details: string;
}

function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function standardCsvLine(row: StandardExportRow): string {
  return [
    row.timestamp,
    escapeCsvField(row.type),
    escapeCsvField(row.service),
    escapeCsvField(row.admin),
    escapeCsvField(row.details),
  ].join(',');
}

export function exportStandardCsv(rows: StandardExportRow[], filenamePrefix: string): void {
  const header = 'timestamp,type,service,admin,details';
  const lines = [header, ...rows.map(standardCsvLine)];
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportStandardJson(rows: StandardExportRow[], filenamePrefix: string): void {
  const json = JSON.stringify(rows, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
