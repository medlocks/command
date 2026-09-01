/**
 * A small, dependency-free CSV parser (Requirements Section 8.2 —
 * minimal-dependency bias already established throughout this codebase).
 * Handles quoted fields (including embedded commas, quotes, and
 * newlines) per RFC 4180's basics — enough for a real-world Fresha
 * export, not a general-purpose CSV library.
 */

/** Splits raw CSV text into rows of raw string cells. The header row is `rows[0]`, untouched — callers map columns by name, not position. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings up front so the character-by-character walk
  // below only ever has to handle '\n' as a row break.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Final field/row, if the file doesn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing rows (a common trailing-newline artifact).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Maps a header row to a name→index lookup, trimmed and case-insensitive, since real exports occasionally vary in whitespace/casing. */
export function headerIndex(headerRow: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  headerRow.forEach((name, i) => index.set(name.trim().toLowerCase(), i));
  return index;
}

/** Reads a named column from a data row using a header index — never throws on a missing column, returns null so callers decide whether that's a hard-fail. */
export function cell(row: readonly string[], index: Map<string, number>, columnName: string): string | null {
  const i = index.get(columnName.trim().toLowerCase());
  if (i === undefined) return null;
  const value = row[i];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
