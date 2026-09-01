import { supabase } from '@/lib/supabase/client';
import { mapDbCategoryToApp } from './serviceCategories';
import type { Database } from '@/lib/supabase/database.types';
import type { Appointment, ClientServiceHistory, UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for `appointments` and the derived
 * `client_service_history` table (Requirements Section 4.2).
 */

type AppointmentRow = Database['public']['Tables']['appointments']['Row'];
type ClientServiceHistoryRow = Database['public']['Tables']['client_service_history']['Row'];

// `service_category_id` is a foreign key — resolving the category requires
// a join, since the DB row alone only has the raw service name.
type AppointmentRowWithCategory = AppointmentRow & {
  service_categories: { category: string } | null;
};
type HistoryRowWithCategory = ClientServiceHistoryRow & {
  service_categories: { category: string } | null;
};

function mapAppointmentRow(row: AppointmentRowWithCategory): Appointment {
  return {
    id: row.id,
    clientId: row.client_id,
    stylistId: row.stylist_id,
    serviceName: row.raw_service_name ?? '',
    serviceCategory: mapDbCategoryToApp(row.service_categories?.category ?? 'other'),
    price: row.price,
    retailAddonAmount: row.retail_addon_amount ?? 0,
    status: (row.status as Appointment['status'] | null) ?? 'completed',
    date: row.appointment_date,
  };
}

function mapHistoryRow(row: HistoryRowWithCategory): ClientServiceHistory {
  return {
    clientId: row.client_id,
    serviceCategory: mapDbCategoryToApp(row.service_categories?.category ?? 'other'),
    averageIntervalDays: row.avg_interval_days ?? 0,
    lastVisitDate: row.last_visit_date ?? '',
    predictedNextDueDate: row.predicted_next_due_date ?? '',
    isLowConfidence: row.confidence !== 'high',
  };
}

export async function listAppointmentsForClient(clientId: UUID): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*, service_categories(category)')
    .eq('client_id', clientId)
    .order('appointment_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapAppointmentRow(row as AppointmentRowWithCategory));
}

/**
 * Reads the derived `client_service_history` table — populated by the
 * insight engine's deterministic layer (`@/modules/insight-engine/deterministic`),
 * not computed here. This function only reads what's already been written.
 */
export async function getServiceHistoryForClient(clientId: UUID): Promise<ClientServiceHistory[]> {
  const { data, error } = await supabase
    .from('client_service_history')
    .select('*, service_categories(category)')
    .eq('client_id', clientId);

  if (error) throw error;
  return (data ?? []).map((row) => mapHistoryRow(row as HistoryRowWithCategory));
}
