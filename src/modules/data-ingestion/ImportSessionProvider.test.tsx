import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportSessionProvider, useImportSession } from './ImportSessionProvider';
import type { ImportResult } from './adapters/types';
import type { ClientListRow } from './fresha/clientList';
import type { SalesSummaryByTeamMemberRow } from './fresha/salesSummaryByTeamMember';
import type { AppointmentRow } from './fresha/appointmentList';

const clientResult: ImportResult<ClientListRow> = {
  rowCount: 2,
  validationErrors: [{ row: 3, field: 'Client', message: 'Missing client name' }],
  records: [
    {
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
    },
  ],
};

const stylistSalesResult: ImportResult<SalesSummaryByTeamMemberRow> = {
  rowCount: 1,
  validationErrors: [],
  records: [
    {
      teamMemberName: 'Alex Stone',
      salesQty: 42,
      itemsSold: 45,
      grossSales: 1200,
      totalDiscounts: 50,
      refunds: 10,
      netSales: 1140,
      taxes: 228,
      totalSales: 1368,
    },
  ],
};

const appointmentResult: ImportResult<AppointmentRow> = {
  rowCount: 1,
  validationErrors: [],
  records: [
    {
      apptRef: 'APT-1001',
      clientName: 'Jane Doe',
      teamMemberName: 'Alex Stone',
      resource: null,
      status: 'Completed',
      createdDate: '2026-08-10',
      scheduledDate: '2026-08-14',
      cancelledDate: null,
      category: 'Colour Services',
      service: 'Balayage',
      durationMinutes: 90,
      apptSlot: null,
      createdBy: null,
      cancelledBy: null,
      location: null,
      netSales: 120,
      cancellationReason: null,
      feesCharged: 0,
      prepayments: 0,
    },
  ],
};

function WriterConsumer() {
  const { commitClientList, commitStylistSales, commitAppointments } = useImportSession();
  return (
    <div>
      <button onClick={() => commitClientList(clientResult, 'clients.csv')}>Commit clients</button>
      <button onClick={() => commitStylistSales(stylistSalesResult, 'sales.csv', '2026-08-01', '2026-08-07')}>
        Commit stylist sales
      </button>
      <button onClick={() => commitAppointments(appointmentResult, 'appointments.csv')}>Commit appointments</button>
    </div>
  );
}

function ReaderConsumer() {
  const { clients, stylistSales, appointments, batches } = useImportSession();
  return (
    <div>
      <p data-testid="client-count">{clients.length}</p>
      <p data-testid="stylist-sales-count">{stylistSales.length}</p>
      <p data-testid="appointment-count">{appointments.length}</p>
      <p data-testid="batch-count">{batches.length}</p>
      <p data-testid="first-stylist-id">{stylistSales[0] ? String(stylistSales[0].stylistId) : '(none)'}</p>
    </div>
  );
}

describe('ImportSessionProvider', () => {
  it('shares a committed client-list batch with another consumer under the same Provider', () => {
    render(
      <ImportSessionProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </ImportSessionProvider>,
    );

    expect(screen.getByTestId('client-count').textContent).toBe('0');
    fireEvent.click(screen.getByText('Commit clients'));
    expect(screen.getByTestId('client-count').textContent).toBe('1');
    expect(screen.getByTestId('batch-count').textContent).toBe('1');
  });

  it('leaves stylistId null on committed stylist sales rows (no fake-roster matching)', () => {
    render(
      <ImportSessionProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </ImportSessionProvider>,
    );

    fireEvent.click(screen.getByText('Commit stylist sales'));
    expect(screen.getByTestId('stylist-sales-count').textContent).toBe('1');
    expect(screen.getByTestId('first-stylist-id').textContent).toBe('null');
  });

  it('shares a committed appointment-list batch with another consumer under the same Provider', () => {
    render(
      <ImportSessionProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </ImportSessionProvider>,
    );

    expect(screen.getByTestId('appointment-count').textContent).toBe('0');
    fireEvent.click(screen.getByText('Commit appointments'));
    expect(screen.getByTestId('appointment-count').textContent).toBe('1');
  });

  it('accumulates batches across multiple commits without dropping earlier ones', () => {
    render(
      <ImportSessionProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </ImportSessionProvider>,
    );

    fireEvent.click(screen.getByText('Commit clients'));
    fireEvent.click(screen.getByText('Commit stylist sales'));
    fireEvent.click(screen.getByText('Commit appointments'));
    expect(screen.getByTestId('batch-count').textContent).toBe('3');
  });

  it('does not leak committed data between two independent Provider instances', () => {
    render(
      <div>
        <ImportSessionProvider>
          <WriterConsumer />
        </ImportSessionProvider>
        <ImportSessionProvider>
          <ReaderConsumer />
        </ImportSessionProvider>
      </div>,
    );

    fireEvent.click(screen.getByText('Commit clients'));
    expect(screen.getByTestId('client-count').textContent).toBe('0');
  });
});
