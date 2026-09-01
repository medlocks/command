/**
 * Client-side CSV export (Requirements Section 6 — MVP is a manual export
 * of flagged client segments, ready to import into Mailchimp; direct API
 * push is Phase 2). No backend needed — this runs entirely in the browser.
 */
function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: readonly Record<string, string>[], columns: readonly string[]): string {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col] ?? '')).join(','));
  return [header, ...body].join('\r\n');
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
