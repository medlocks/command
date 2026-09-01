import type { ValidationError } from '../adapters/types';

/**
 * Field-level parsers for values as Fresha's real exports actually format
 * them (Requirements Section 3.1, confirmed 19 Aug 2026) — not a generic
 * date/number parser, this one specific format.
 */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Matches `"14 Nov 2025, 12:00am"` — day, 3-letter month, year, comma, 12-hour time with am/pm. Only the date part is kept; the app's schema stores these as `date`, not `timestamptz`. */
const FRESHA_DATE_PATTERN = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*\d{1,2}:\d{2}\s*(am|pm)$/i;

/**
 * Parses a Fresha-formatted date string into `YYYY-MM-DD`, or `null` if
 * the input doesn't match the expected shape at all — callers treat a
 * non-null-but-unparseable string as a validation error, and a genuinely
 * blank/absent field as just missing data (not the same thing).
 */
export function parseFreshaDate(raw: string): string | null {
  const match = FRESHA_DATE_PATTERN.exec(raw.trim());
  if (!match) return null;

  const [, dayStr, monthStr, yearStr] = match;
  const month = MONTH_INDEX[monthStr!.toLowerCase()];
  if (month === undefined) return null;

  const day = Number(dayStr);
  const year = Number(yearStr);
  if (day < 1 || day > 31) return null;

  // Validate the date actually exists (e.g. reject "31 Feb 2025") by
  // round-tripping through Date and checking the parts survived.
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;

  return date.toISOString().slice(0, 10);
}

/** Parses a Fresha date field for a CSV row and records a validation error if it's non-blank but unparseable — a blank field is left as `null` silently, since "no date recorded" and "malformed date" mean different things to the person reviewing the import. Shared across every adapter that has Fresha-formatted date columns. */
export function parseFreshaDateField(
  raw: string | null,
  fieldLabel: string,
  rowNumber: number,
  errors: ValidationError[],
): string | null {
  if (raw === null) return null;
  const parsed = parseFreshaDate(raw);
  if (parsed === null) {
    errors.push({ row: rowNumber, field: fieldLabel, message: `Malformed date: "${raw}"` });
  }
  return parsed;
}

/** Matches Fresha's `"1h 10min"` duration text — either part may be absent (`"45min"`, `"2h"`), but at least one must be present. */
const DURATION_PATTERN = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?$/i;

/** Parses Fresha's text duration format (e.g. `"1h 10min"`) into total minutes. Returns `null` for blank or unrecognized input — the column name says "(mins)" but the actual export is free text, not a number (Requirements Section 3.1). */
export function parseDurationMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) return null;

  const [, hoursStr, minutesStr] = match;
  if (hoursStr === undefined && minutesStr === undefined) return null;

  const hours = hoursStr ? Number(hoursStr) : 0;
  const minutes = minutesStr ? Number(minutesStr) : 0;
  return hours * 60 + minutes;
}

/** Parses a money string like `"£1,234.56"` or `"1234.56"` into a number. Returns `null` for anything that isn't recognizably a number, including blank. */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.trim().replace(/[£,\s]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Parses a money field for a CSV row: blank → 0, no error (a row with no recorded amount is normal, not a validation failure); a non-blank but unparseable value → 0, with a validation error, since silently keeping a nonsense value would be worse than a visible zero. Shared across every adapter with money columns. */
export function parseMoneyField(
  raw: string | null,
  fieldLabel: string,
  rowNumber: number,
  errors: ValidationError[],
): number {
  if (raw === null) return 0;
  const value = parseMoney(raw);
  if (value === null) {
    errors.push({ row: rowNumber, field: fieldLabel, message: `Malformed number: "${raw}"` });
    return 0;
  }
  return value;
}

/** Parses a plain integer field (e.g. Age, Loyalty points balance). Returns `null` for blank or unparseable — never NaN. */
export function parseInteger(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && Number.isInteger(value) ? value : null;
}
