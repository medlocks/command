// Supabase Edge Function (Deno) — the general-purpose real write path into
// the live warehouse (Requirements Section 3.2's live-data cutover). Same
// pattern as `ad-spend-write`: service-role key bypasses RLS entirely
// (there is no login flow — a deliberate, standing scope call, not an
// oversight — see that function's doc comment for the full reasoning),
// gated by the same low-bar shared-secret header.
//
// Deliberately generic (`entity` + `action` dispatch) rather than one
// function per data type — `ad-spend-write` stays untouched and separate
// (no reason to risk something already working), but every new entity
// from here on lands in this one function so the number of deployed
// functions doesn't grow linearly with the number of data types this
// cutover eventually covers.
//
// Entities handled so far:
//   - clients      — application-level dedup (email primary, mobile
//                    fallback, excluding soft-deleted rows) since `clients`
//                    has no DB-level unique constraint to upsert against
//                    (unlike `ad_spend_daily`/`fresha_appointments`/`services`).
//                    Existing matches are SKIPPED, never overwritten — no
//                    destructive overwrites (Requirements Section 4.3).
//   - appointments — writes to `fresha_appointments`, NOT the legacy mock
//                    `appointments` table. Native upsert on `appt_ref`,
//                    the first genuinely stable ID confirmed from any
//                    Fresha report.
//   - stylist_wages — plain insert, validated against a real stylist_id.
//                     Sensitive data (Requirements Section 3.5) — no
//                     implicit mutation of prior wage rows.
//   - stylist_hours — real per-stylist contracted hours/week (added 23 Aug
//                     2026), same effective-dated shape as stylist_wages
//                     — a stylist's hours changing later doesn't rewrite
//                     past periods' utilization. Feeds real capacity in
//                     `warehouse-read`'s stylist_profitability(_by_period),
//                     replacing what used to be one shared salon-wide
//                     assumption applied to every stylist identically.
//   - services      — upserts the supporting `service_categories` row
//                     first (raw_service_name is unique there too), then
//                     upserts `services` itself.
//   - product_costs — plain insert, no unique constraint to lean on and
//                     none invented — additive only (Section 4.3).
//   - sales_summary_by_type — plain insert, same reasoning as product_costs
//                     (no unique constraint on the table). Feeds the real
//                     salon-wide retail conversion calc in `warehouse-read`.
//   - stylists      — application-level dedup by exact name match (same
//                     reasoning as clients — no unique constraint on
//                     `name`), skips existing rather than duplicating a
//                     stylist across two IDs. The only commit path for the
//                     roster itself; everything else (wages, real
//                     profitability) was blocked on this not existing.
//   - recommendations — the real to-do-list persistence path (Requirements
//                     Section 5.5/5.4.1/12). Two actions, not `commit`:
//                       - sync_cycle: insert-per-cycle with carry-forward.
//                         The browser computes the candidate list itself
//                         (reusing `buildRankedTodoList` unchanged, fed
//                         with real warehouse-read data — a deliberate,
//                         disclosed departure from every other entity here,
//                         where the Edge Function is the source of truth;
//                         acceptable only because there's no auth/multi-
//                         user access yet). For each candidate: if a row
//                         for the same stable key (stored in `category`)
//                         already exists for today's cycle_date, its
//                         content is refreshed in place (no duplicate same-
//                         day history rows); otherwise the most recent
//                         prior row for that key is looked up and its
//                         status/notes are carried forward if still open
//                         (pending/in_progress), then a fresh row is
//                         inserted with today's cycle_date. Full history is
//                         never overwritten — only today's own row, if it
//                         already exists, is touched in place.
//                       - update: a direct status/notes edit against one
//                         real row by its real `id`, replacing the old
//                         session-only override Map.
//   - client_insight_dismissal — manual "I checked, this one's fine"
//                     overrides for Clients' colour-top-up/lapse-risk
//                     lists (added 23 Aug 2026). Two actions: `commit`
//                     (upsert on client_id+insight_type+category) and
//                     `remove` (un-dismiss). See `client_insight_dismissals`'
//                     own schema comment for the clears-on-next-real-visit
//                     design — no expiry stored here, computed at read
//                     time in `warehouse-read`.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------

interface ClientCommitRow {
  full_name: string;
  gender?: string | null;
  age?: number | null;
  email?: string | null;
  mobile?: string | null;
  added_date?: string | null;
  first_appointment_date?: string | null;
  last_appointment_date?: string | null;
  loyalty_points_balance?: number | null;
  loyalty_tier?: string | null;
  client_source?: string | null;
  referred_by?: string | null;
}

async function handleClientsCommit(rows: unknown): Promise<Response> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ ok: false, error: 'rows must be a non-empty array' }, 400);
  }

  const parsed = rows as ClientCommitRow[];
  for (const row of parsed) {
    if (!row.full_name || typeof row.full_name !== 'string') {
      return jsonResponse({ ok: false, error: 'Every row needs a full_name' }, 400);
    }
    if (!row.email && !row.mobile) {
      return jsonResponse({ ok: false, error: `Row for "${row.full_name}" has neither email nor mobile` }, 400);
    }
  }

  // Fetch every non-deleted real client's email/mobile once, compare
  // case/whitespace-insensitively in JS — avoids PostgREST case-sensitive
  // `.in()` matching missing a real duplicate over a casing difference.
  // Fine at any realistic single-salon scale.
  const { data: existingClients, error: fetchError } = await supabase
    .from('clients')
    .select('email, mobile')
    .is('deleted_at', null);
  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const existingEmails = new Set(
    (existingClients ?? []).map((c) => c.email?.toLowerCase()).filter((e): e is string => !!e),
  );
  const existingMobiles = new Set(
    (existingClients ?? []).map((c) => c.mobile?.replace(/\s+/g, '')).filter((m): m is string => !!m),
  );

  const toInsert: ClientCommitRow[] = [];
  let skipped = 0;

  for (const row of parsed) {
    const emailKey = row.email?.toLowerCase();
    const mobileKey = row.mobile?.replace(/\s+/g, '');
    const isDuplicate = (!!emailKey && existingEmails.has(emailKey)) || (!!mobileKey && existingMobiles.has(mobileKey));

    if (isDuplicate) {
      skipped++;
      continue;
    }

    toInsert.push(row);
    // Also guard against duplicates within this same batch, not just
    // against what was already in the table before this call.
    if (emailKey) existingEmails.add(emailKey);
    if (mobileKey) existingMobiles.add(mobileKey);
  }

  if (toInsert.length === 0) {
    return jsonResponse({ ok: true, rowsWritten: 0, rowsSkipped: skipped, note: 'All rows already existed' });
  }

  // marketing_consent / profiling_opt_out are deliberately never set here
  // — they stay at the schema default (false). This import path never
  // captures real consent, so never assume it (Requirements Section 10.1).
  const { error: insertError } = await supabase.from('clients').insert(toInsert);
  if (insertError) return jsonResponse({ ok: false, error: insertError.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: toInsert.length, rowsSkipped: skipped });
}

// ---------------------------------------------------------------------
// appointments -> fresha_appointments
// ---------------------------------------------------------------------

interface AppointmentCommitRow {
  apptRef: string;
  clientName: string;
  teamMemberName?: string | null;
  resource?: string | null;
  status: string;
  createdDate?: string | null;
  scheduledDate?: string | null;
  cancelledDate?: string | null;
  category?: string | null;
  service?: string | null;
  durationMinutes?: number | null;
  apptSlot?: string | null;
  createdBy?: string | null;
  cancelledBy?: string | null;
  location?: string | null;
  netSales?: number;
  cancellationReason?: string | null;
  feesCharged?: number;
  prepayments?: number;
}

async function handleAppointmentsCommit(rows: unknown): Promise<Response> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ ok: false, error: 'rows must be a non-empty array' }, 400);
  }

  const parsed = rows as AppointmentCommitRow[];
  for (const row of parsed) {
    if (!row.apptRef || !row.clientName || !row.status) {
      return jsonResponse({ ok: false, error: 'Every row needs apptRef, clientName, and status' }, 400);
    }
  }

  const dbRows = parsed.map((row) => ({
    appt_ref: row.apptRef,
    client_name: row.clientName,
    team_member_name: row.teamMemberName ?? null,
    resource: row.resource ?? null,
    status: row.status,
    created_date: row.createdDate ?? null,
    scheduled_date: row.scheduledDate ?? null,
    cancelled_date: row.cancelledDate ?? null,
    category: row.category ?? null,
    service: row.service ?? null,
    duration_minutes: row.durationMinutes ?? null,
    appt_slot: row.apptSlot ?? null,
    created_by: row.createdBy ?? null,
    cancelled_by: row.cancelledBy ?? null,
    location: row.location ?? null,
    net_sales: row.netSales ?? 0,
    cancellation_reason: row.cancellationReason ?? null,
    fees_charged: row.feesCharged ?? 0,
    prepayments: row.prepayments ?? 0,
  }));

  const { error } = await supabase.from('fresha_appointments').upsert(dbRows, { onConflict: 'appt_ref' });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: dbRows.length });
}

// ---------------------------------------------------------------------
// stylist_wages
// ---------------------------------------------------------------------

interface StylistWageCommitPayload {
  stylistId: string;
  hourlyRate: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

async function handleStylistWageCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistWageCommitPayload> | null;
  if (!p || typeof p.stylistId !== 'string' || !p.stylistId) {
    return jsonResponse({ ok: false, error: 'stylistId is required' }, 400);
  }
  if (typeof p.hourlyRate !== 'number' || !Number.isFinite(p.hourlyRate) || p.hourlyRate < 0) {
    return jsonResponse({ ok: false, error: 'hourlyRate must be a non-negative number' }, 400);
  }
  if (typeof p.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom)) {
    return jsonResponse({ ok: false, error: 'effectiveFrom must be a YYYY-MM-DD date string' }, 400);
  }

  // Real FK check up front — a clearer, purpose-built error than letting
  // the insert fail on a generic FK-violation message.
  const { data: stylist, error: stylistError } = await supabase
    .from('stylists')
    .select('id')
    .eq('id', p.stylistId)
    .maybeSingle();
  if (stylistError) return jsonResponse({ ok: false, error: stylistError.message }, 500);
  if (!stylist) return jsonResponse({ ok: false, error: 'No stylist exists with that ID' }, 404);

  const { error } = await supabase.from('stylist_wages').insert({
    stylist_id: p.stylistId,
    hourly_rate: p.hourlyRate,
    effective_from: p.effectiveFrom,
    effective_to: p.effectiveTo ?? null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// stylist_hours — real per-stylist contracted hours/week (added 23 Aug
// 2026), mirroring stylist_wages exactly: an effective-dated table, not a
// flat column, so a stylist's hours changing later (e.g. an apprentice
// going full-time) doesn't silently rewrite past periods' utilization.
// Feeds real capacity in `warehouse-read`'s stylist_profitability(_by_period)
// — see that function's own doc comment for the full reasoning and the
// DEFAULT_WEEKLY_HOURS fallback for any stylist with no real entry yet.
// ---------------------------------------------------------------------

interface StylistHoursCommitPayload {
  stylistId: string;
  hoursPerWeek: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

async function handleStylistHoursCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistHoursCommitPayload> | null;
  if (!p || typeof p.stylistId !== 'string' || !p.stylistId) {
    return jsonResponse({ ok: false, error: 'stylistId is required' }, 400);
  }
  if (typeof p.hoursPerWeek !== 'number' || !Number.isFinite(p.hoursPerWeek) || p.hoursPerWeek < 0) {
    return jsonResponse({ ok: false, error: 'hoursPerWeek must be a non-negative number' }, 400);
  }
  if (typeof p.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom)) {
    return jsonResponse({ ok: false, error: 'effectiveFrom must be a YYYY-MM-DD date string' }, 400);
  }

  const { data: stylist, error: stylistError } = await supabase
    .from('stylists')
    .select('id')
    .eq('id', p.stylistId)
    .maybeSingle();
  if (stylistError) return jsonResponse({ ok: false, error: stylistError.message }, 500);
  if (!stylist) return jsonResponse({ ok: false, error: 'No stylist exists with that ID' }, 404);

  const { error } = await supabase.from('stylist_hours').insert({
    stylist_id: p.stylistId,
    hours_per_week: p.hoursPerWeek,
    effective_from: p.effectiveFrom,
    effective_to: p.effectiveTo ?? null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// stylist_working_pattern — real per-weekday hours (added 23 Aug 2026), an
// optional richer refinement of stylist_hours' flat weekly total. Same
// effective-dated shape, one row per (stylist, day_of_week) version — see
// `stylist_working_pattern`'s own schema comment for the full reasoning and
// the three-layer capacity fallback in warehouse-read.
// ---------------------------------------------------------------------

interface StylistWorkingPatternCommitPayload {
  stylistId: string;
  dayOfWeek: number;
  hours: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

async function handleStylistWorkingPatternCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistWorkingPatternCommitPayload> | null;
  if (!p || typeof p.stylistId !== 'string' || !p.stylistId) {
    return jsonResponse({ ok: false, error: 'stylistId is required' }, 400);
  }
  if (typeof p.dayOfWeek !== 'number' || !Number.isInteger(p.dayOfWeek) || p.dayOfWeek < 0 || p.dayOfWeek > 6) {
    return jsonResponse({ ok: false, error: 'dayOfWeek must be an integer 0 (Sunday) through 6 (Saturday)' }, 400);
  }
  if (typeof p.hours !== 'number' || !Number.isFinite(p.hours) || p.hours < 0) {
    return jsonResponse({ ok: false, error: 'hours must be a non-negative number' }, 400);
  }
  if (typeof p.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom)) {
    return jsonResponse({ ok: false, error: 'effectiveFrom must be a YYYY-MM-DD date string' }, 400);
  }

  const { data: stylist, error: stylistError } = await supabase
    .from('stylists')
    .select('id')
    .eq('id', p.stylistId)
    .maybeSingle();
  if (stylistError) return jsonResponse({ ok: false, error: stylistError.message }, 500);
  if (!stylist) return jsonResponse({ ok: false, error: 'No stylist exists with that ID' }, 404);

  const { error } = await supabase.from('stylist_working_pattern').insert({
    stylist_id: p.stylistId,
    day_of_week: p.dayOfWeek,
    hours: p.hours,
    effective_from: p.effectiveFrom,
    effective_to: p.effectiveTo ?? null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// stylist_leave — real holiday/absence dates (added 23 Aug 2026). Not
// effective-dated (these are one-off real events, not a rate that
// supersedes an older one) — plain insert, plus a remove for correcting a
// mistaken entry. Subtracted from capacity for any period it overlaps, see
// `stylist_leave`'s own schema comment.
// ---------------------------------------------------------------------

const VALID_LEAVE_TYPES = new Set(['holiday', 'sick', 'other']);

interface StylistLeaveCommitPayload {
  stylistId: string;
  dateStart: string;
  dateEnd: string;
  leaveType?: string;
  notes?: string | null;
}

async function handleStylistLeaveCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistLeaveCommitPayload> | null;
  if (!p || typeof p.stylistId !== 'string' || !p.stylistId) {
    return jsonResponse({ ok: false, error: 'stylistId is required' }, 400);
  }
  if (typeof p.dateStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dateStart)) {
    return jsonResponse({ ok: false, error: 'dateStart must be a YYYY-MM-DD date string' }, 400);
  }
  if (typeof p.dateEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dateEnd)) {
    return jsonResponse({ ok: false, error: 'dateEnd must be a YYYY-MM-DD date string' }, 400);
  }
  if (p.dateEnd < p.dateStart) {
    return jsonResponse({ ok: false, error: 'dateEnd cannot be before dateStart' }, 400);
  }
  const leaveType = p.leaveType ?? 'holiday';
  if (!VALID_LEAVE_TYPES.has(leaveType)) {
    return jsonResponse({ ok: false, error: `leaveType must be one of: ${[...VALID_LEAVE_TYPES].join(', ')}` }, 400);
  }

  const { data: stylist, error: stylistError } = await supabase
    .from('stylists')
    .select('id')
    .eq('id', p.stylistId)
    .maybeSingle();
  if (stylistError) return jsonResponse({ ok: false, error: stylistError.message }, 500);
  if (!stylist) return jsonResponse({ ok: false, error: 'No stylist exists with that ID' }, 404);

  const { error } = await supabase.from('stylist_leave').insert({
    stylist_id: p.stylistId,
    date_start: p.dateStart,
    date_end: p.dateEnd,
    leave_type: leaveType,
    notes: p.notes ?? null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleStylistLeaveRemove(payload: unknown): Promise<Response> {
  const p = payload as { id?: string } | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const { error } = await supabase.from('stylist_leave').delete().eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// services (+ supporting service_categories row)
// ---------------------------------------------------------------------

const VALID_SERVICE_CATEGORIES = new Set(['colour', 'cut', 'chemical_treatment', 'retail', 'other']);

interface ServiceCommitPayload {
  rawServiceName: string;
  /** Optional as of 4 Sep 2026 — pricing analysis uses real realized averages from appointments now, not a manually-typed price/duration. Kept as an optional manual override for a service with no real bookings yet. */
  price?: number | null;
  durationMinutes?: number | null;
  estimatedProductCost?: number | null;
  isEstimate?: boolean;
  category: string;
}

async function handleServiceCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<ServiceCommitPayload> | null;
  if (!p || typeof p.rawServiceName !== 'string' || !p.rawServiceName) {
    return jsonResponse({ ok: false, error: 'rawServiceName is required' }, 400);
  }
  if (p.price !== undefined && p.price !== null && (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0)) {
    return jsonResponse({ ok: false, error: 'price must be a non-negative number' }, 400);
  }
  if (
    p.durationMinutes !== undefined &&
    p.durationMinutes !== null &&
    (typeof p.durationMinutes !== 'number' || !Number.isInteger(p.durationMinutes) || p.durationMinutes <= 0)
  ) {
    return jsonResponse({ ok: false, error: 'durationMinutes must be a positive integer' }, 400);
  }
  if (typeof p.category !== 'string' || !VALID_SERVICE_CATEGORIES.has(p.category)) {
    return jsonResponse({ ok: false, error: `category must be one of: ${[...VALID_SERVICE_CATEGORIES].join(', ')}` }, 400);
  }

  const { error: catError } = await supabase
    .from('service_categories')
    .upsert(
      { raw_service_name: p.rawServiceName, category: p.category, is_colour_category: p.category === 'colour' },
      { onConflict: 'raw_service_name' },
    );
  if (catError) return jsonResponse({ ok: false, error: catError.message }, 500);

  const { error: svcError } = await supabase.from('services').upsert(
    {
      raw_service_name: p.rawServiceName,
      price: p.price ?? null,
      duration_minutes: p.durationMinutes ?? null,
      estimated_product_cost: p.estimatedProductCost ?? null,
      is_estimate: p.isEstimate ?? true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'raw_service_name' },
  );
  if (svcError) return jsonResponse({ ok: false, error: svcError.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// product_costs
// ---------------------------------------------------------------------

interface ProductCostCommitPayload {
  periodStart: string;
  periodEnd: string;
  category?: string | null;
  amount: number;
  notes?: string | null;
}

async function handleProductCostCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<ProductCostCommitPayload> | null;
  if (!p || typeof p.periodStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.periodStart)) {
    return jsonResponse({ ok: false, error: 'periodStart must be a YYYY-MM-DD date string' }, 400);
  }
  if (typeof p.periodEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.periodEnd)) {
    return jsonResponse({ ok: false, error: 'periodEnd must be a YYYY-MM-DD date string' }, 400);
  }
  if (p.periodStart > p.periodEnd) {
    return jsonResponse({ ok: false, error: 'periodStart must not be after periodEnd' }, 400);
  }
  if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount < 0) {
    return jsonResponse({ ok: false, error: 'amount must be a non-negative number' }, 400);
  }

  const { error } = await supabase.from('product_costs').insert({
    period_start: p.periodStart,
    period_end: p.periodEnd,
    category: p.category ?? null,
    amount: p.amount,
    notes: p.notes ?? null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// sales_summary_by_type
// ---------------------------------------------------------------------

interface TypeSalesCommitRow {
  type: string;
  periodStart: string;
  periodEnd: string;
  salesQty?: number;
  itemsSold?: number;
  grossSales?: number;
  totalDiscounts?: number;
  refunds?: number;
  netSales?: number;
  taxes?: number;
  totalSales?: number;
}

async function handleTypeSalesCommit(rows: unknown): Promise<Response> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ ok: false, error: 'rows must be a non-empty array' }, 400);
  }

  const parsed = rows as TypeSalesCommitRow[];
  for (const row of parsed) {
    if (!row.type || !row.periodStart || !row.periodEnd) {
      return jsonResponse({ ok: false, error: 'Every row needs type, periodStart, and periodEnd' }, 400);
    }
  }

  const dbRows = parsed.map((row) => ({
    type: row.type,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    sales_qty: row.salesQty ?? 0,
    items_sold: row.itemsSold ?? 0,
    gross_sales: row.grossSales ?? 0,
    total_discounts: row.totalDiscounts ?? 0,
    refunds: row.refunds ?? 0,
    net_sales: row.netSales ?? 0,
    taxes: row.taxes ?? 0,
    total_sales: row.totalSales ?? 0,
  }));

  // No unique constraint on this table — plain additive insert, same
  // reasoning as product_costs (Requirements Section 4.3).
  const { error } = await supabase.from('sales_summary_by_type').insert(dbRows);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: dbRows.length });
}

// ---------------------------------------------------------------------
// stylists
// ---------------------------------------------------------------------

interface StylistCommitPayload {
  name: string;
  startDate?: string | null;
  employmentStatus?: string;
}

async function handleStylistCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistCommitPayload> | null;
  if (!p || typeof p.name !== 'string' || !p.name.trim()) {
    return jsonResponse({ ok: false, error: 'name is required' }, 400);
  }
  const name = p.name.trim();

  const { data: existing, error: fetchError } = await supabase.from('stylists').select('id, name');
  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const nameKey = name.toLowerCase();
  const isDuplicate = (existing ?? []).some((s) => s.name.toLowerCase() === nameKey);
  if (isDuplicate) {
    return jsonResponse({ ok: true, rowsWritten: 0, note: `"${name}" already exists — not added again.` });
  }

  const { error: insertError } = await supabase.from('stylists').insert({
    name,
    start_date: p.startDate ?? null,
    employment_status: p.employmentStatus ?? 'active',
  });
  if (insertError) return jsonResponse({ ok: false, error: insertError.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

const VALID_EMPLOYMENT_STATUSES = new Set(['active', 'inactive', 'apprentice']);

interface StylistUpdatePayload {
  id: string;
  name?: string;
  startDate?: string | null;
  employmentStatus?: string;
  isProfitShare?: boolean;
}

/**
 * Edit/deactivate an existing stylist (added 23 Aug 2026). "Remove" is
 * deliberately not a delete — wages, hours, appointments, and
 * profitability history all reference this row, and every real read
 * query already filters `.eq('employment_status', 'active')`, so setting
 * `employmentStatus: 'inactive'` here is what actually removes them from
 * every forward-looking view without touching a single historical row.
 * Renaming a stylist does NOT retroactively update past
 * `fresha_appointments.team_member_name` text — that's a known,
 * disclosed limitation of the free-text name match, not a bug here.
 */
async function handleStylistUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<StylistUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || !p.name.trim()) {
      return jsonResponse({ ok: false, error: 'name cannot be empty' }, 400);
    }
    fields.name = p.name.trim();
  }
  if (p.startDate !== undefined) {
    fields.start_date = p.startDate;
  }
  if (p.employmentStatus !== undefined) {
    if (typeof p.employmentStatus !== 'string' || !VALID_EMPLOYMENT_STATUSES.has(p.employmentStatus)) {
      return jsonResponse({ ok: false, error: `employmentStatus must be one of: ${[...VALID_EMPLOYMENT_STATUSES].join(', ')}` }, 400);
    }
    fields.employment_status = p.employmentStatus;
  }
  if (p.isProfitShare !== undefined) {
    fields.is_profit_share = p.isProfitShare;
  }
  if (Object.keys(fields).length === 0) {
    return jsonResponse({ ok: false, error: 'Nothing to update — provide name, startDate, employmentStatus, and/or isProfitShare' }, 400);
  }

  const { error } = await supabase.from('stylists').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// recommendations
// ---------------------------------------------------------------------

interface RecommendationCandidate {
  stableKey: string;
  title: string;
  detail: string;
  priorityScore: number;
  estimatedImpact: number | null;
  impactConfidence: string;
  urgency: string;
}

interface RecommendationRow {
  id: string;
  category: string;
  status: 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';
  notes: string | null;
  cycle_date: string;
}

const OPEN_STATUSES = new Set(['pending', 'in_progress']);

async function handleRecommendationsSyncCycle(payload: unknown): Promise<Response> {
  const p = payload as { candidates?: unknown } | null;
  if (!p || !Array.isArray(p.candidates)) {
    return jsonResponse({ ok: false, error: 'candidates must be an array' }, 400);
  }
  const candidates = p.candidates as RecommendationCandidate[];
  for (const c of candidates) {
    if (!c.stableKey || !c.title || typeof c.priorityScore !== 'number') {
      return jsonResponse({ ok: false, error: 'Every candidate needs stableKey, title, and priorityScore' }, 400);
    }
  }
  if (candidates.length === 0) {
    return jsonResponse({ ok: true, items: [] });
  }

  const today = new Date().toISOString().slice(0, 10);
  const stableKeys = candidates.map((c) => c.stableKey);

  // One fetch for every row (any cycle) matching these stable keys, rather
  // than a per-candidate round trip — bounded by the to-do list's own size
  // (at most ~17 candidates today), fine at this scale.
  const { data: existingRows, error: fetchError } = await supabase
    .from('recommendations')
    .select('id, category, status, notes, cycle_date')
    .in('category', stableKeys)
    .order('cycle_date', { ascending: false });
  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const rowsByKey = new Map<string, RecommendationRow[]>();
  for (const row of (existingRows ?? []) as RecommendationRow[]) {
    const list = rowsByKey.get(row.category) ?? [];
    list.push(row);
    rowsByKey.set(row.category, list);
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  const resultsByKey = new Map<string, { id: string; status: string; notes: string | null }>();

  for (const c of candidates) {
    const rowsForKey = rowsByKey.get(c.stableKey) ?? []; // already sorted latest-cycle-first
    const todaysRow = rowsForKey.find((r) => r.cycle_date === today);
    const contentFields = {
      title: c.title,
      detail: c.detail,
      priority_score: c.priorityScore,
      estimated_impact_gbp: c.estimatedImpact,
      impact_confidence: c.impactConfidence,
      urgency: c.urgency,
    };

    if (todaysRow) {
      // Same-day re-sync (e.g. Home revisited later the same day) —
      // refresh content in place, leave status/notes/id untouched so
      // resolved-history stays exactly one row per key per day.
      toUpdate.push({ id: todaysRow.id, fields: contentFields });
      resultsByKey.set(c.stableKey, { id: todaysRow.id, status: todaysRow.status, notes: todaysRow.notes });
      continue;
    }

    const priorRow = rowsForKey[0] ?? null; // most recent row from an earlier cycle, if any
    const carryForward = priorRow && OPEN_STATUSES.has(priorRow.status);
    const status = carryForward ? priorRow!.status : 'pending';
    const notes = carryForward ? priorRow!.notes : null;

    toInsert.push({ category: c.stableKey, ...contentFields, status, notes, cycle_date: today });
    // Real id isn't known until after the insert — filled in below.
    resultsByKey.set(c.stableKey, { id: '', status, notes });
  }

  for (const { id, fields } of toUpdate) {
    const { error } = await supabase.from('recommendations').update(fields).eq('id', id);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  }

  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabase.from('recommendations').insert(toInsert).select('id, category');
    if (insertError) return jsonResponse({ ok: false, error: insertError.message }, 500);
    for (const row of inserted ?? []) {
      const entry = resultsByKey.get(row.category);
      if (entry) entry.id = row.id;
    }
  }

  const items = candidates.map((c) => ({ stableKey: c.stableKey, ...resultsByKey.get(c.stableKey)! }));
  return jsonResponse({ ok: true, items });
}

interface RecommendationUpdatePayload {
  id: string;
  status?: 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';
  notes?: string | null;
}

const RESOLVED_STATUSES = new Set(['accepted', 'rejected', 'dismissed']);

async function handleRecommendationUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<RecommendationUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.status !== undefined) {
    fields.status = p.status;
    fields.resolved_at = RESOLVED_STATUSES.has(p.status) ? new Date().toISOString() : null;
  }
  if (p.notes !== undefined) {
    fields.notes = p.notes;
  }
  if (Object.keys(fields).length === 0) {
    return jsonResponse({ ok: false, error: 'Nothing to update — provide status and/or notes' }, 400);
  }

  const { error } = await supabase.from('recommendations').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// client_insight_dismissals — manual "I checked, this one's fine"
// overrides for Clients' colour-top-up-due / lapse-risk lists (added 23
// Aug 2026). See `client_insight_dismissals`' own schema comment for the
// full reasoning on the key shape and the clears-on-next-real-visit
// design (no expiry column here — that's computed at read time in
// `warehouse-read` by comparing `dismissed_at` against the real, matched
// `lastVisitDate`, not stored as a TTL).
// ---------------------------------------------------------------------

const VALID_INSIGHT_TYPES = new Set(['colour-top-up', 'lapse-risk']);

interface InsightDismissalPayload {
  clientId: string;
  insightType: string;
  category: string;
  note?: string | null;
}

async function handleInsightDismissalCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<InsightDismissalPayload> | null;
  if (!p || typeof p.clientId !== 'string' || !p.clientId) {
    return jsonResponse({ ok: false, error: 'clientId is required' }, 400);
  }
  if (typeof p.insightType !== 'string' || !VALID_INSIGHT_TYPES.has(p.insightType)) {
    return jsonResponse({ ok: false, error: `insightType must be one of: ${[...VALID_INSIGHT_TYPES].join(', ')}` }, 400);
  }
  if (typeof p.category !== 'string' || !p.category) {
    return jsonResponse({ ok: false, error: 'category is required' }, 400);
  }

  // Upsert on the (client_id, insight_type, category) unique constraint —
  // re-dismissing the same concern refreshes dismissed_at/note rather than
  // erroring or duplicating.
  const { error } = await supabase.from('client_insight_dismissals').upsert(
    {
      client_id: p.clientId,
      insight_type: p.insightType,
      category: p.category,
      note: p.note ?? null,
      dismissed_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,insight_type,category' },
  );
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleInsightDismissalRemove(payload: unknown): Promise<Response> {
  const p = payload as Partial<InsightDismissalPayload> | null;
  if (!p || typeof p.clientId !== 'string' || !p.clientId) {
    return jsonResponse({ ok: false, error: 'clientId is required' }, 400);
  }
  if (typeof p.insightType !== 'string' || !VALID_INSIGHT_TYPES.has(p.insightType)) {
    return jsonResponse({ ok: false, error: `insightType must be one of: ${[...VALID_INSIGHT_TYPES].join(', ')}` }, 400);
  }
  if (typeof p.category !== 'string' || !p.category) {
    return jsonResponse({ ok: false, error: 'category is required' }, 400);
  }

  const { error } = await supabase
    .from('client_insight_dismissals')
    .delete()
    .eq('client_id', p.clientId)
    .eq('insight_type', p.insightType)
    .eq('category', p.category);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// products (Requirements Section 3.7) — the manually-maintained catalog
// behind both stock mechanisms. Read-only/seeded scope this round (30 Aug
// 2026): commit + update exist so a starter set can be entered via Manual
// Data, but there's no add/remove/edit-with-soft-delete UI yet — that's a
// separate, later round. "Removing" a product is `isActive: false` here,
// never a hard delete — keeps any open stock_flags/service_product_usage
// history resolving to the same row, same reasoning as stylists'
// employment_status.
// ---------------------------------------------------------------------

interface ProductCommitPayload {
  name: string;
  unit?: string | null;
  reorderThreshold?: number | null;
  currentEstimatedStock?: number | null;
  supplier?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  approxCostPerUnit?: number | null;
  isCritical?: boolean;
}

async function handleProductCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<ProductCommitPayload> | null;
  if (!p || typeof p.name !== 'string' || !p.name.trim()) {
    return jsonResponse({ ok: false, error: 'name is required' }, 400);
  }
  const name = p.name.trim();

  const { data: existing, error: fetchError } = await supabase.from('products').select('id, name');
  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const nameKey = name.toLowerCase();
  const isDuplicate = (existing ?? []).some((row) => row.name.toLowerCase() === nameKey);
  if (isDuplicate) {
    return jsonResponse({ ok: true, rowsWritten: 0, note: `"${name}" already exists — not added again.` });
  }

  const { error: insertError } = await supabase.from('products').insert({
    name,
    unit: p.unit ?? null,
    reorder_threshold: p.reorderThreshold ?? null,
    current_estimated_stock: p.currentEstimatedStock ?? null,
    supplier: p.supplier ?? null,
    supplier_email: p.supplierEmail ?? null,
    supplier_phone: p.supplierPhone ?? null,
    approx_cost_per_unit: p.approxCostPerUnit ?? null,
    is_critical: p.isCritical ?? false,
  });
  if (insertError) return jsonResponse({ ok: false, error: insertError.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

interface ProductUpdatePayload {
  id: string;
  name?: string;
  unit?: string | null;
  reorderThreshold?: number | null;
  currentEstimatedStock?: number | null;
  supplier?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  approxCostPerUnit?: number | null;
  isCritical?: boolean;
  isActive?: boolean;
}

async function handleProductUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<ProductUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || !p.name.trim()) {
      return jsonResponse({ ok: false, error: 'name cannot be empty' }, 400);
    }
    fields.name = p.name.trim();
  }
  if (p.unit !== undefined) fields.unit = p.unit;
  if (p.reorderThreshold !== undefined) fields.reorder_threshold = p.reorderThreshold;
  if (p.currentEstimatedStock !== undefined) fields.current_estimated_stock = p.currentEstimatedStock;
  if (p.supplier !== undefined) fields.supplier = p.supplier;
  if (p.supplierEmail !== undefined) fields.supplier_email = p.supplierEmail;
  if (p.supplierPhone !== undefined) fields.supplier_phone = p.supplierPhone;
  if (p.approxCostPerUnit !== undefined) fields.approx_cost_per_unit = p.approxCostPerUnit;
  if (p.isCritical !== undefined) fields.is_critical = p.isCritical;
  if (p.isActive !== undefined) fields.is_active = p.isActive;
  if (Object.keys(fields).length === 0) {
    return jsonResponse({ ok: false, error: 'Nothing to update' }, 400);
  }
  fields.updated_at = new Date().toISOString();

  const { error } = await supabase.from('products').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// stock_flags (Requirements Section 3.7, Mechanism 1) — the fast "running
// low on X" flag. `flaggedBy` stays free text (Section 13, Q18 — no full
// staff accounts exist), same as the existing `stock_flags_broad_insert`
// RLS policy already anticipates (moot in practice, since this Edge
// Function uses the service-role key like everywhere else — RLS never
// actually runs against these writes).
// ---------------------------------------------------------------------

const VALID_STOCK_URGENCIES = new Set(['low', 'out']);

interface StockFlagCommitPayload {
  productId: string;
  urgency: string;
  flaggedBy?: string | null;
}

async function handleStockFlagCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<StockFlagCommitPayload> | null;
  if (!p || typeof p.productId !== 'string' || !p.productId) {
    return jsonResponse({ ok: false, error: 'productId is required' }, 400);
  }
  if (typeof p.urgency !== 'string' || !VALID_STOCK_URGENCIES.has(p.urgency)) {
    return jsonResponse({ ok: false, error: `urgency must be one of: ${[...VALID_STOCK_URGENCIES].join(', ')}` }, 400);
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id')
    .eq('id', p.productId)
    .maybeSingle();
  if (productError) return jsonResponse({ ok: false, error: productError.message }, 500);
  if (!product) return jsonResponse({ ok: false, error: 'No product exists with that ID' }, 404);

  const { error } = await supabase.from('stock_flags').insert({
    product_id: p.productId,
    urgency: p.urgency,
    flagged_by: p.flaggedBy?.trim() || null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleStockFlagResolve(payload: unknown): Promise<Response> {
  const p = payload as { id?: string } | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const { error } = await supabase
    .from('stock_flags')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// service_product_usage (Requirements Section 3.7, Mechanism 2) — links a
// service to how much of a product it's estimated to consume per booking,
// the input the predictive consumption forecast is built from. Upserts on
// the (raw_service_name, product_id) unique constraint. `raw_service_name`
// is a real FK to `service_categories` — requires that service to already
// be known (from a real appointment import or the Service Catalog form),
// same "match the exact Fresha text" constraint services/service costs
// already carry.
// ---------------------------------------------------------------------

interface ServiceProductUsageCommitPayload {
  rawServiceName: string;
  productId: string;
  estimatedQuantityPerService?: number | null;
}

async function handleServiceProductUsageCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<ServiceProductUsageCommitPayload> | null;
  if (!p || typeof p.rawServiceName !== 'string' || !p.rawServiceName) {
    return jsonResponse({ ok: false, error: 'rawServiceName is required' }, 400);
  }
  if (typeof p.productId !== 'string' || !p.productId) {
    return jsonResponse({ ok: false, error: 'productId is required' }, 400);
  }

  const { data: category, error: categoryError } = await supabase
    .from('service_categories')
    .select('raw_service_name')
    .eq('raw_service_name', p.rawServiceName)
    .maybeSingle();
  if (categoryError) return jsonResponse({ ok: false, error: categoryError.message }, 500);
  if (!category) {
    return jsonResponse(
      { ok: false, error: `"${p.rawServiceName}" isn't a known service yet — it needs a real appointment import or a Service Catalog entry first.` },
      404,
    );
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id')
    .eq('id', p.productId)
    .maybeSingle();
  if (productError) return jsonResponse({ ok: false, error: productError.message }, 500);
  if (!product) return jsonResponse({ ok: false, error: 'No product exists with that ID' }, 404);

  const { error } = await supabase.from('service_product_usage').upsert(
    {
      raw_service_name: p.rawServiceName,
      product_id: p.productId,
      estimated_quantity_per_service: p.estimatedQuantityPerService ?? null,
    },
    { onConflict: 'raw_service_name,product_id' },
  );
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// industry_benchmarks (Requirements Section 3.4, Stage 1 of this area's
// cutover, added 30 Aug 2026) — owner-curated reference notes ("a living
// internal salon playbook... you maintain and expand over time"), never
// live-synced or bulk-imported. Full commit/update/remove, not append-only
// like product_costs — this is meant to be actively revised, not just
// added to. Nothing else in the schema references this table, so remove
// is a real delete, no soft-delete/orphan concern the way products/
// stylists have. Stages 2 (Chat context) and 3 (deterministic-threshold
// wiring) are separate, later rounds — this stage is only the real
// commit/read path and the Manual Data form.
// ---------------------------------------------------------------------

interface IndustryBenchmarkCommitPayload {
  topic: string;
  principle: string;
  applicationNotes?: string | null;
  targetMetric?: string | null;
  targetValue?: number | null;
  sourceNote?: string | null;
}

async function handleIndustryBenchmarkCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<IndustryBenchmarkCommitPayload> | null;
  if (!p || typeof p.topic !== 'string' || !p.topic.trim()) {
    return jsonResponse({ ok: false, error: 'topic is required' }, 400);
  }
  if (typeof p.principle !== 'string' || !p.principle.trim()) {
    return jsonResponse({ ok: false, error: 'principle is required' }, 400);
  }

  const { error } = await supabase.from('industry_benchmarks').insert({
    topic: p.topic.trim(),
    principle: p.principle.trim(),
    application_notes: p.applicationNotes?.trim() || null,
    target_metric: p.targetMetric?.trim() || null,
    target_value: p.targetValue ?? null,
    source_note: p.sourceNote?.trim() || null,
  });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

interface IndustryBenchmarkUpdatePayload {
  id: string;
  topic?: string;
  principle?: string;
  applicationNotes?: string | null;
  targetMetric?: string | null;
  targetValue?: number | null;
  sourceNote?: string | null;
}

async function handleIndustryBenchmarkUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<IndustryBenchmarkUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.topic !== undefined) {
    if (typeof p.topic !== 'string' || !p.topic.trim()) {
      return jsonResponse({ ok: false, error: 'topic cannot be empty' }, 400);
    }
    fields.topic = p.topic.trim();
  }
  if (p.principle !== undefined) {
    if (typeof p.principle !== 'string' || !p.principle.trim()) {
      return jsonResponse({ ok: false, error: 'principle cannot be empty' }, 400);
    }
    fields.principle = p.principle.trim();
  }
  if (p.applicationNotes !== undefined) fields.application_notes = p.applicationNotes?.trim() || null;
  if (p.targetMetric !== undefined) fields.target_metric = p.targetMetric?.trim() || null;
  if (p.targetValue !== undefined) fields.target_value = p.targetValue;
  if (p.sourceNote !== undefined) fields.source_note = p.sourceNote?.trim() || null;
  if (Object.keys(fields).length === 0) {
    return jsonResponse({ ok: false, error: 'Nothing to update' }, 400);
  }
  fields.updated_at = new Date().toISOString();

  const { error } = await supabase.from('industry_benchmarks').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleIndustryBenchmarkRemove(payload: unknown): Promise<Response> {
  const p = payload as { id?: string } | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const { error } = await supabase.from('industry_benchmarks').delete().eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// MedLocks retail product line (added 5 Sep 2026) — a separate business
// domain from salon services (manufacturing + retail, not stylists/
// appointments). Deliberately separate tables from the salon's own
// `products` (operational stock), not a shared concept. Cost-per-unit is
// never written directly — it's always recomputed server-side in
// warehouse-read from real ingredient purchase prices and recipe
// quantities, so changing one ingredient's price recomputes every SKU
// using it, rather than needing every affected SKU hand-edited.
// ---------------------------------------------------------------------

interface RetailIngredientPayload {
  name: string;
  purchasePrice: number;
  purchaseQuantity: number;
  unit: string;
  notes?: string | null;
}

async function handleRetailIngredientCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<RetailIngredientPayload> | null;
  if (!p || typeof p.name !== 'string' || !p.name.trim()) {
    return jsonResponse({ ok: false, error: 'name is required' }, 400);
  }
  if (typeof p.purchasePrice !== 'number' || !Number.isFinite(p.purchasePrice) || p.purchasePrice < 0) {
    return jsonResponse({ ok: false, error: 'purchasePrice must be a non-negative number' }, 400);
  }
  if (typeof p.purchaseQuantity !== 'number' || !Number.isFinite(p.purchaseQuantity) || p.purchaseQuantity <= 0) {
    return jsonResponse({ ok: false, error: 'purchaseQuantity must be a positive number' }, 400);
  }
  if (typeof p.unit !== 'string' || !p.unit.trim()) {
    return jsonResponse({ ok: false, error: 'unit is required' }, 400);
  }

  const { data, error } = await supabase
    .from('retail_ingredients')
    .insert({
      name: p.name.trim(),
      purchase_price: p.purchasePrice,
      purchase_quantity: p.purchaseQuantity,
      unit: p.unit.trim(),
      notes: p.notes ?? null,
    })
    .select('id')
    .single();
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1, id: data.id });
}

interface RetailIngredientUpdatePayload extends Partial<RetailIngredientPayload> {
  id: string;
}

async function handleRetailIngredientUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<RetailIngredientUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || !p.name.trim()) return jsonResponse({ ok: false, error: 'name cannot be empty' }, 400);
    fields.name = p.name.trim();
  }
  if (p.purchasePrice !== undefined) {
    if (typeof p.purchasePrice !== 'number' || !Number.isFinite(p.purchasePrice) || p.purchasePrice < 0) {
      return jsonResponse({ ok: false, error: 'purchasePrice must be a non-negative number' }, 400);
    }
    fields.purchase_price = p.purchasePrice;
  }
  if (p.purchaseQuantity !== undefined) {
    if (typeof p.purchaseQuantity !== 'number' || !Number.isFinite(p.purchaseQuantity) || p.purchaseQuantity <= 0) {
      return jsonResponse({ ok: false, error: 'purchaseQuantity must be a positive number' }, 400);
    }
    fields.purchase_quantity = p.purchaseQuantity;
  }
  if (p.unit !== undefined) {
    if (typeof p.unit !== 'string' || !p.unit.trim()) return jsonResponse({ ok: false, error: 'unit cannot be empty' }, 400);
    fields.unit = p.unit.trim();
  }
  if (p.notes !== undefined) fields.notes = p.notes;
  if (Object.keys(fields).length === 0) return jsonResponse({ ok: false, error: 'Nothing to update' }, 400);
  fields.updated_at = new Date().toISOString();

  const { error } = await supabase.from('retail_ingredients').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleRetailIngredientRemove(payload: unknown): Promise<Response> {
  const p = payload as { id?: string } | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }
  // Hard delete, deliberately — this is an internal costing tool with no
  // customer-facing history to preserve, unlike salon client/appointment
  // data. Cascades to any recipe lines using this ingredient.
  const { error } = await supabase.from('retail_ingredients').delete().eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

interface RetailSkuPayload {
  name: string;
  description?: string | null;
  inSalonPrice?: number | null;
  onlinePrice?: number | null;
  shippingPackagingCost?: number | null;
  /** % off online_price a wholesale/retail partner would expect (added 5 Sep 2026) — 0.5 = 50% off. Defaults to 0.5 in the schema (a stated, editable assumption) if omitted. */
  wholesaleDiscountPct?: number | null;
  /** Real weekly production ceiling at current effort (added 5 Sep 2026), e.g. 200 bottles/week hand-mixed part-time. */
  weeklyCapacityUnits?: number | null;
  /** Free-text note on what happens past the weekly ceiling, in the owner's own words (e.g. "can go full-time and scale into the 1000s/week") rather than a fabricated second capacity number. */
  capacityScaleNote?: string | null;
}

async function handleRetailSkuCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<RetailSkuPayload> | null;
  if (!p || typeof p.name !== 'string' || !p.name.trim()) {
    return jsonResponse({ ok: false, error: 'name is required' }, 400);
  }
  if (p.wholesaleDiscountPct !== undefined && p.wholesaleDiscountPct !== null) {
    if (typeof p.wholesaleDiscountPct !== 'number' || !Number.isFinite(p.wholesaleDiscountPct) || p.wholesaleDiscountPct < 0 || p.wholesaleDiscountPct >= 1) {
      return jsonResponse({ ok: false, error: 'wholesaleDiscountPct must be between 0 and 1 (e.g. 0.5 for 50% off)' }, 400);
    }
  }
  if (p.weeklyCapacityUnits !== undefined && p.weeklyCapacityUnits !== null) {
    if (typeof p.weeklyCapacityUnits !== 'number' || !Number.isFinite(p.weeklyCapacityUnits) || p.weeklyCapacityUnits < 0) {
      return jsonResponse({ ok: false, error: 'weeklyCapacityUnits must be a non-negative number' }, 400);
    }
  }

  const insertRow: Record<string, unknown> = {
    name: p.name.trim(),
    description: p.description ?? null,
    in_salon_price: p.inSalonPrice ?? null,
    online_price: p.onlinePrice ?? null,
    shipping_packaging_cost: p.shippingPackagingCost ?? null,
  };
  if (p.wholesaleDiscountPct !== undefined && p.wholesaleDiscountPct !== null) insertRow.wholesale_discount_pct = p.wholesaleDiscountPct;
  if (p.weeklyCapacityUnits !== undefined) insertRow.weekly_capacity_units = p.weeklyCapacityUnits;
  if (p.capacityScaleNote !== undefined) insertRow.capacity_scale_note = p.capacityScaleNote;

  const { data, error } = await supabase.from('retail_skus').insert(insertRow).select('id').single();
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1, id: data.id });
}

interface RetailSkuUpdatePayload extends Partial<RetailSkuPayload> {
  id: string;
  isActive?: boolean;
}

async function handleRetailSkuUpdate(payload: unknown): Promise<Response> {
  const p = payload as Partial<RetailSkuUpdatePayload> | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }

  const fields: Record<string, unknown> = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || !p.name.trim()) return jsonResponse({ ok: false, error: 'name cannot be empty' }, 400);
    fields.name = p.name.trim();
  }
  if (p.description !== undefined) fields.description = p.description;
  if (p.inSalonPrice !== undefined) fields.in_salon_price = p.inSalonPrice;
  if (p.onlinePrice !== undefined) fields.online_price = p.onlinePrice;
  if (p.shippingPackagingCost !== undefined) fields.shipping_packaging_cost = p.shippingPackagingCost;
  if (p.wholesaleDiscountPct !== undefined) {
    if (p.wholesaleDiscountPct !== null && (typeof p.wholesaleDiscountPct !== 'number' || !Number.isFinite(p.wholesaleDiscountPct) || p.wholesaleDiscountPct < 0 || p.wholesaleDiscountPct >= 1)) {
      return jsonResponse({ ok: false, error: 'wholesaleDiscountPct must be between 0 and 1 (e.g. 0.5 for 50% off)' }, 400);
    }
    fields.wholesale_discount_pct = p.wholesaleDiscountPct;
  }
  if (p.weeklyCapacityUnits !== undefined) {
    if (p.weeklyCapacityUnits !== null && (typeof p.weeklyCapacityUnits !== 'number' || !Number.isFinite(p.weeklyCapacityUnits) || p.weeklyCapacityUnits < 0)) {
      return jsonResponse({ ok: false, error: 'weeklyCapacityUnits must be a non-negative number' }, 400);
    }
    fields.weekly_capacity_units = p.weeklyCapacityUnits;
  }
  if (p.capacityScaleNote !== undefined) fields.capacity_scale_note = p.capacityScaleNote;
  if (p.isActive !== undefined) fields.is_active = p.isActive;
  if (Object.keys(fields).length === 0) return jsonResponse({ ok: false, error: 'Nothing to update' }, 400);
  fields.updated_at = new Date().toISOString();

  const { error } = await supabase.from('retail_skus').update(fields).eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

interface RetailRecipeItemPayload {
  skuId: string;
  ingredientId: string;
  quantityUsed: number;
}

async function handleRetailRecipeItemCommit(payload: unknown): Promise<Response> {
  const p = payload as Partial<RetailRecipeItemPayload> | null;
  if (!p || typeof p.skuId !== 'string' || !p.skuId) return jsonResponse({ ok: false, error: 'skuId is required' }, 400);
  if (typeof p.ingredientId !== 'string' || !p.ingredientId) return jsonResponse({ ok: false, error: 'ingredientId is required' }, 400);
  if (typeof p.quantityUsed !== 'number' || !Number.isFinite(p.quantityUsed) || p.quantityUsed <= 0) {
    return jsonResponse({ ok: false, error: 'quantityUsed must be a positive number' }, 400);
  }

  const { error } = await supabase
    .from('retail_recipe_items')
    .upsert(
      { sku_id: p.skuId, ingredient_id: p.ingredientId, quantity_used: p.quantityUsed },
      { onConflict: 'sku_id,ingredient_id' },
    );
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

async function handleRetailRecipeItemRemove(payload: unknown): Promise<Response> {
  const p = payload as { id?: string } | null;
  if (!p || typeof p.id !== 'string' || !p.id) {
    return jsonResponse({ ok: false, error: 'id is required' }, 400);
  }
  const { error } = await supabase.from('retail_recipe_items').delete().eq('id', p.id);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: 1 });
}

// ---------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------

interface RequestBody {
  entity:
    | 'clients'
    | 'appointments'
    | 'stylist_wages'
    | 'stylist_hours'
    | 'stylist_working_pattern'
    | 'stylist_leave'
    | 'services'
    | 'product_costs'
    | 'sales_summary_by_type'
    | 'stylists'
    | 'products'
    | 'stock_flags'
    | 'service_product_usage'
    | 'industry_benchmarks'
    | 'recommendations'
    | 'client_insight_dismissal'
    | 'retail_ingredients'
    | 'retail_skus'
    | 'retail_recipe_items';
  action: 'commit' | 'sync_cycle' | 'update' | 'remove' | 'resolve';
  rows?: unknown;
  payload?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (body.entity === 'recommendations') {
    if (body.action === 'sync_cycle') return handleRecommendationsSyncCycle(body.payload);
    if (body.action === 'update') return handleRecommendationUpdate(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for recommendations' }, 400);
  }

  if (body.entity === 'client_insight_dismissal') {
    if (body.action === 'commit') return handleInsightDismissalCommit(body.payload);
    if (body.action === 'remove') return handleInsightDismissalRemove(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for client_insight_dismissal' }, 400);
  }

  if (body.entity === 'stylists' && body.action === 'update') {
    return handleStylistUpdate(body.payload);
  }

  if (body.entity === 'stylist_leave') {
    if (body.action === 'commit') return handleStylistLeaveCommit(body.payload);
    if (body.action === 'remove') return handleStylistLeaveRemove(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for stylist_leave' }, 400);
  }

  if (body.entity === 'products' && body.action === 'update') {
    return handleProductUpdate(body.payload);
  }

  if (body.entity === 'stock_flags') {
    if (body.action === 'commit') return handleStockFlagCommit(body.payload);
    if (body.action === 'resolve') return handleStockFlagResolve(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for stock_flags' }, 400);
  }

  if (body.entity === 'industry_benchmarks') {
    if (body.action === 'commit') return handleIndustryBenchmarkCommit(body.payload);
    if (body.action === 'update') return handleIndustryBenchmarkUpdate(body.payload);
    if (body.action === 'remove') return handleIndustryBenchmarkRemove(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for industry_benchmarks' }, 400);
  }

  if (body.entity === 'retail_ingredients') {
    if (body.action === 'commit') return handleRetailIngredientCommit(body.payload);
    if (body.action === 'update') return handleRetailIngredientUpdate(body.payload);
    if (body.action === 'remove') return handleRetailIngredientRemove(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for retail_ingredients' }, 400);
  }

  if (body.entity === 'retail_skus') {
    if (body.action === 'commit') return handleRetailSkuCommit(body.payload);
    if (body.action === 'update') return handleRetailSkuUpdate(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for retail_skus' }, 400);
  }

  if (body.entity === 'retail_recipe_items') {
    if (body.action === 'commit') return handleRetailRecipeItemCommit(body.payload);
    if (body.action === 'remove') return handleRetailRecipeItemRemove(body.payload);
    return jsonResponse({ ok: false, error: 'Unknown action for retail_recipe_items' }, 400);
  }

  if (body.action !== 'commit') {
    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  }

  switch (body.entity) {
    case 'clients':
      return handleClientsCommit(body.rows);
    case 'appointments':
      return handleAppointmentsCommit(body.rows);
    case 'stylist_wages':
      return handleStylistWageCommit(body.payload);
    case 'stylist_hours':
      return handleStylistHoursCommit(body.payload);
    case 'stylist_working_pattern':
      return handleStylistWorkingPatternCommit(body.payload);
    case 'services':
      return handleServiceCommit(body.payload);
    case 'product_costs':
      return handleProductCostCommit(body.payload);
    case 'sales_summary_by_type':
      return handleTypeSalesCommit(body.rows);
    case 'stylists':
      return handleStylistCommit(body.payload);
    case 'products':
      return handleProductCommit(body.payload);
    case 'service_product_usage':
      return handleServiceProductUsageCommit(body.payload);
    default:
      return jsonResponse({ ok: false, error: 'Unknown entity' }, 400);
  }
});
