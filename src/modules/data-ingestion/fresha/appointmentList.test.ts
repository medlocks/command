import { describe, expect, it } from 'vitest';
import { parseAppointmentListFile } from './appointmentList';

const HEADER =
  'Appt. ref.,Client,Team member,Resource,Status,Created date,Scheduled date,Cancelled date,Category,Service,Duration (mins),Appt. slot,Created by,Cancelled by,Location,Net sales,Cancellation reason,Fees charged,Prepayments';

function makeFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'appointments.csv', { type: 'text/csv' });
}

describe('parseAppointmentListFile', () => {
  it('parses a well-formed row', async () => {
    const file = makeFile([
      'APT-1001,Jane Doe,Alex Stone,Chair 1,Completed,"10 Aug 2026, 9:00am","14 Aug 2026, 10:00am",,Colour Services,Balayage,"1h 30min",10:00am,Front desk,,Main salon,"£120.00",,0.00,0.00',
    ]);
    const result = await parseAppointmentListFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toEqual([
      {
        apptRef: 'APT-1001',
        clientName: 'Jane Doe',
        teamMemberName: 'Alex Stone',
        resource: 'Chair 1',
        status: 'Completed',
        createdDate: '2026-08-10',
        scheduledDate: '2026-08-14',
        cancelledDate: null,
        category: 'Colour Services',
        service: 'Balayage',
        durationMinutes: 90,
        apptSlot: '10:00am',
        createdBy: 'Front desk',
        cancelledBy: null,
        location: 'Main salon',
        netSales: 120,
        cancellationReason: null,
        feesCharged: 0,
        prepayments: 0,
      },
    ]);
  });

  it('hard-fails a row missing the appointment reference', async () => {
    const file = makeFile([',Jane Doe,Alex Stone,,Completed,,,,,,,,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Appt. ref.', message: 'Missing appointment reference' });
  });

  it('hard-fails a row missing the client', async () => {
    const file = makeFile(['APT-1001,,Alex Stone,,Completed,,,,,,,,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Client' });
  });

  it('detects a duplicate appointment reference and drops the later row', async () => {
    const file = makeFile([
      'APT-1001,Jane Doe,Alex Stone,,Completed,,,,,,,,,,,,,,',
      'APT-1001,Amara Okafor,Priya Shah,,Completed,,,,,,,,,,,,,,',
    ]);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors[0]).toMatchObject({ row: 3, field: 'Appt. ref.' });
  });

  it('keeps the row but flags an unrecognized status', async () => {
    const file = makeFile(['APT-1001,Jane Doe,Alex Stone,,Pending,,,,,,,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.status).toBe('Pending');
    expect(result.validationErrors).toEqual([{ row: 2, field: 'Status', message: 'Unrecognized status: "Pending"' }]);
  });

  it('flags a malformed scheduled date but keeps the row, nulling only that field', async () => {
    const file = makeFile(['APT-1001,Jane Doe,Alex Stone,,Completed,,not-a-date,,,,,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.scheduledDate).toBeNull();
    expect(result.validationErrors).toEqual([{ row: 2, field: 'Scheduled date', message: 'Malformed date: "not-a-date"' }]);
  });

  it('flags a malformed duration but keeps the row, nulling only that field', async () => {
    const file = makeFile(['APT-1001,Jane Doe,Alex Stone,,Completed,,,,,,not-a-duration,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.durationMinutes).toBeNull();
    expect(result.validationErrors).toEqual([{ row: 2, field: 'Duration (mins)', message: 'Malformed duration: "not-a-duration"' }]);
  });

  it('defaults a blank team member to null without an error', async () => {
    const file = makeFile(['APT-1001,Jane Doe,,,Completed,,,,,,,,,,,,,,']);
    const result = await parseAppointmentListFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records[0]?.teamMemberName).toBeNull();
  });

  it('rejects a file missing expected columns', async () => {
    const file = new File(['Client,Total\nJane,120'], 'appointments.csv', { type: 'text/csv' });
    const result = await parseAppointmentListFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });
});
