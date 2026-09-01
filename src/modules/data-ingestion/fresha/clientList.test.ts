import { describe, expect, it } from 'vitest';
import { parseClientListFile } from './clientList';

const HEADER =
  'Client,Gender,Age,Mobile number,Email,Added on,First appt.,Last appt.,Loyalty points balance,Loyalty tier,Client source,Referred by';

function makeFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'clients.csv', { type: 'text/csv' });
}

describe('parseClientListFile', () => {
  it('parses a well-formed row, including the confirmed Fresha date format', async () => {
    const file = makeFile([
      'Jane Doe,Female,34,07700900001,jane@example.com,"14 Nov 2025, 12:00am","14 Nov 2025, 12:00am","1 Jan 2026, 3:30pm",120,Gold,Instagram,',
    ]);
    const result = await parseClientListFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      full_name: 'Jane Doe',
      gender: 'Female',
      age: 34,
      email: 'jane@example.com',
      mobile: '07700900001',
      added_date: '2025-11-14',
      first_appointment_date: '2025-11-14',
      last_appointment_date: '2026-01-01',
      loyalty_points_balance: 120,
      loyalty_tier: 'Gold',
      client_source: 'Instagram',
      referred_by: null,
    });
  });

  it('treats blank Age and Loyalty tier as normal, not a validation error', async () => {
    const file = makeFile(['Jane Doe,Female,,07700900001,jane@example.com,,,,,,,']);
    const result = await parseClientListFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records[0]?.age).toBeNull();
    expect(result.records[0]?.loyalty_tier).toBeNull();
  });

  it('hard-fails a row missing both email and mobile', async () => {
    const file = makeFile(['Jane Doe,Female,34,,,,,,,,,']);
    const result = await parseClientListFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Email / Mobile number' });
  });

  it('hard-fails a row missing the client name', async () => {
    const file = makeFile([',Female,34,07700900001,jane@example.com,,,,,,,']);
    const result = await parseClientListFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Client' });
  });

  it('flags a malformed date but keeps the row, nulling only that field', async () => {
    const file = makeFile(['Jane Doe,Female,34,07700900001,jane@example.com,not-a-date,,,,,,']);
    const result = await parseClientListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.added_date).toBeNull();
    expect(result.validationErrors).toEqual([{ row: 2, field: 'Added on', message: 'Malformed date: "not-a-date"' }]);
  });

  it('detects a duplicate by email and drops the later row', async () => {
    const file = makeFile([
      'Jane Doe,Female,34,07700900001,jane@example.com,,,,,,,',
      'Jane D,Female,34,07700900002,jane@example.com,,,,,,,',
    ]);
    const result = await parseClientListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.validationErrors).toEqual([
      { row: 3, field: 'Client', message: 'Duplicate client (matches an earlier row by email)' },
    ]);
  });

  it('falls back to mobile for dedup when email is absent', async () => {
    const file = makeFile([
      'Jane Doe,Female,34,07700900001,,,,,,,,',
      'Jane D,Female,34,07700900001,,,,,,,,',
    ]);
    const result = await parseClientListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.validationErrors[0]?.message).toContain('mobile number');
  });

  it('rejects a file missing expected columns', async () => {
    const file = new File(['Name,Email\nJane,jane@example.com'], 'clients.csv', { type: 'text/csv' });
    const result = await parseClientListFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });
});
