import { describe, expect, it } from 'vitest';
import {
  parseDurationMinutes,
  parseFreshaDate,
  parseFreshaDateField,
  parseInteger,
  parseMoney,
  parseMoneyField,
} from './parsing';

describe('parseFreshaDate', () => {
  it('parses the confirmed Fresha date format to ISO', () => {
    expect(parseFreshaDate('14 Nov 2025, 12:00am')).toBe('2025-11-14');
  });

  it('parses a pm time correctly (time-of-day is discarded, not used for rollover)', () => {
    expect(parseFreshaDate('1 Jan 2026, 11:59pm')).toBe('2026-01-01');
  });

  it('returns null for garbage input', () => {
    expect(parseFreshaDate('not a date')).toBeNull();
  });

  it('returns null for a nonexistent calendar date', () => {
    expect(parseFreshaDate('31 Feb 2025, 12:00am')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(parseFreshaDate('')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('parses a plain number', () => {
    expect(parseMoney('42.50')).toBe(42.5);
  });

  it('strips the pound sign and thousands separators', () => {
    expect(parseMoney('£1,234.56')).toBe(1234.56);
  });

  it('returns null for blank input', () => {
    expect(parseMoney('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseMoney('N/A')).toBeNull();
  });
});

describe('parseInteger', () => {
  it('parses a plain integer', () => {
    expect(parseInteger('42')).toBe(42);
  });

  it('returns null for a non-integer number', () => {
    expect(parseInteger('42.5')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(parseInteger('')).toBeNull();
  });
});

describe('parseFreshaDateField', () => {
  it('returns the parsed date with no error for a well-formed value', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseFreshaDateField('14 Nov 2025, 12:00am', 'Added on', 2, errors)).toBe('2025-11-14');
    expect(errors).toEqual([]);
  });

  it('returns null with no error for a blank field', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseFreshaDateField(null, 'Added on', 2, errors)).toBeNull();
    expect(errors).toEqual([]);
  });

  it('returns null with a validation error for a malformed value', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseFreshaDateField('not-a-date', 'Added on', 2, errors)).toBeNull();
    expect(errors).toEqual([{ row: 2, field: 'Added on', message: 'Malformed date: "not-a-date"' }]);
  });
});

describe('parseMoneyField', () => {
  it('returns the parsed value with no error for a well-formed value', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseMoneyField('£42.50', 'Net sales', 2, errors)).toBe(42.5);
    expect(errors).toEqual([]);
  });

  it('defaults to 0 with no error for a blank field', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseMoneyField(null, 'Net sales', 2, errors)).toBe(0);
    expect(errors).toEqual([]);
  });

  it('defaults to 0 with a validation error for a malformed value', () => {
    const errors: { row: number; field: string; message: string }[] = [];
    expect(parseMoneyField('N/A', 'Net sales', 2, errors)).toBe(0);
    expect(errors).toEqual([{ row: 2, field: 'Net sales', message: 'Malformed number: "N/A"' }]);
  });
});

describe('parseDurationMinutes', () => {
  it('parses "1h 0min"', () => {
    expect(parseDurationMinutes('1h 0min')).toBe(60);
  });

  it('parses "1h 10min"', () => {
    expect(parseDurationMinutes('1h 10min')).toBe(70);
  });

  it('parses a minutes-only value', () => {
    expect(parseDurationMinutes('45min')).toBe(45);
  });

  it('parses an hours-only value', () => {
    expect(parseDurationMinutes('2h')).toBe(120);
  });

  it('returns null for blank input', () => {
    expect(parseDurationMinutes('')).toBeNull();
  });

  it('returns null for unrecognized input', () => {
    expect(parseDurationMinutes('an hour')).toBeNull();
  });
});
