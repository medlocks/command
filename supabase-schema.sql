-- =====================================================================
-- Salon AI Command Centre — Supabase Schema (v1)
-- Maps to salon-ai-requirements.md Section 4 (Data Warehouse) and
-- Section 10 (GDPR — retention, deletion, access control fields baked in)
-- Run this in the Supabase SQL editor on a fresh project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Users & Roles (Section 2)
-- Supabase Auth provides auth.users automatically — this table extends
-- it with app-specific role info. One row per authenticated user.
-- ---------------------------------------------------------------------
create type user_role as enum ('owner', 'manager', 'stylist', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'manager',
  full_name text,
  linked_stylist_id uuid, -- set if role = 'stylist', links to stylists table below
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Stylists (referenced by appointments, wages, profitability calcs)
-- ---------------------------------------------------------------------
create table public.stylists (
  id uuid primary key default gen_random_uuid(),
  fresha_stylist_id text unique, -- external ID from Fresha export, for matching on import
  name text not null,
  employment_status text not null default 'active', -- active | inactive | apprentice
  start_date date,
  -- Added 4 Sep 2026 — a partner paid from profit share, not a wage, has
  -- no real hourly-rate figure to enter at all (not missing data, a
  -- genuinely different compensation structure). Every place that computes
  -- wage-cost-based margin/profit-per-hour must check this and label
  -- accordingly — a profit-share stylist's wageCost is correctly 0, but
  -- that makes her margin/profit numbers look artificially perfect if
  -- shown next to a waged stylist's without saying so.
  is_profit_share boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Stylist wages & costs (Section 3.5) — sensitive, owner-only via RLS
-- ---------------------------------------------------------------------
create table public.stylist_wages (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists(id) on delete cascade,
  hourly_rate numeric(10,2) not null, -- confirmed hourly pay model (requirements Section 3.5, 13 Q8)
  effective_from date not null,
  effective_to date, -- null = current
  created_at timestamptz not null default now()
);

-- Real per-stylist contracted hours/week (added 23 Aug 2026) — the
-- capacity denominator behind utilization, Growth Roadmap's capacity
-- stage, and the Hiring Signal, all previously computed against one
-- shared 40h/week (8h×5d) assumption applied to every stylist identically.
-- Mirrors stylist_wages' shape exactly, not a flat column on `stylists` —
-- a stylist's hours changing later (an apprentice going full-time) would
-- otherwise silently rewrite past periods' utilization as if the new
-- figure had always been true, the same kind of quiet historical
-- distortion the recommendation-cycle ID fix (Stage 4) was built to avoid.
-- A stylist with no row here yet falls back to the 40h/week default —
-- see `DEFAULT_WEEKLY_HOURS` in warehouse-read's own doc comment.
create table public.stylist_hours (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists(id) on delete cascade,
  hours_per_week numeric(5,2) not null,
  effective_from date not null,
  effective_to date, -- null = current
  created_at timestamptz not null default now()
);

-- Real per-stylist per-weekday availability (added 23 Aug 2026) — a richer,
-- optional refinement of stylist_hours' flat weekly total. Where present,
-- capacity is computed as a real day-by-day sum (this weekday's real hours,
-- minus any day covered by stylist_leave below) rather than spreading
-- weeklyHours evenly across every calendar day including days off. A
-- stylist with no pattern row for a given weekday falls back to
-- stylist_hours' averaged hours_per_week/7 for that day — see the
-- three-layer fallback in warehouse-read's own doc comment. Same
-- effective-dated shape as stylist_wages/stylist_hours, for the same
-- reason: a pattern change later must never rewrite past periods.
create table public.stylist_working_pattern (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Sunday .. 6=Saturday
  hours numeric(5,2) not null check (hours >= 0),
  effective_from date not null,
  effective_to date, -- null = current
  created_at timestamptz not null default now()
);

-- Real holiday/annual-leave dates per stylist (added 23 Aug 2026) — actual
-- dates taken, not the 28-day/year entitlement figure (which never enters
-- the capacity math, only a form would validate against it). Any real date
-- range here is subtracted from that stylist's capacity for the periods it
-- overlaps, regardless of whether a real stylist_working_pattern exists —
-- see warehouse-read's three-layer fallback for the precise rate used when
-- no per-day pattern is on file yet.
create table public.stylist_leave (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists(id) on delete cascade,
  date_start date not null,
  date_end date not null check (date_end >= date_start),
  leave_type text not null default 'holiday', -- holiday | sick | other
  notes text,
  created_at timestamptz not null default now()
);

-- Product/COGS cost tracking (Section 3.5), manual entry
create table public.product_costs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  category text, -- e.g. 'colour', 'retail', 'general supplies'
  amount numeric(10,2) not null,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Staff recruitment & retention tracking (Section 5.12)
-- ---------------------------------------------------------------------
create table public.job_applicants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  stage text not null default 'applied', -- applied | interviewed | offered | hired | rejected
  role_applied_for text,
  applied_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  role_title text not null,
  opened_date date not null,
  closed_date date, -- null = still open
  filled_by_applicant_id uuid references public.job_applicants(id),
  estimated_weekly_revenue_impact numeric(10,2), -- for the urgency signal in Section 5.12
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clients (Section 4.2) — deduped canonical record
--
-- Shape confirmed against a real Fresha "Client list" export (Section 3.1,
-- reviewed 19 Aug 2026) — replaces the earlier assumption-based columns.
-- The real export has no stable client ID column at all, so dedup on
-- import runs on `email` (primary) with `mobile` as fallback, not
-- `fresha_client_id` — that column stays in case a live/API export ever
-- exposes a real one, but nothing currently relies on it being populated.
-- `full_name` replaces the old first_name/last_name split: the export
-- gives one combined `Client` field, and splitting it with a naive
-- space-heuristic would silently mis-split real names.
-- ---------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  fresha_client_id text unique, -- external ID, kept for a future live connector — not populated by the current manual CSV export
  full_name text not null,
  gender text, -- free text as Fresha provides it, not constrained to an enum
  age integer, -- frequently blank in the real export — nullable, not a validation failure
  email text,
  mobile text,
  added_date date,
  first_appointment_date date,
  last_appointment_date date,
  loyalty_points_balance integer,
  loyalty_tier text, -- frequently blank in the real export — nullable, not a validation failure
  client_source text, -- e.g. how the client found the salon — distinct from `referred_by`
  referred_by text, -- a referring client's name, as Fresha provides it — not a resolved client_id
  marketing_consent boolean not null default false, -- GDPR Section 10.1/10.4
  profiling_opt_out boolean not null default false,  -- GDPR Section 10.4 — right to object to profiling
  deleted_at timestamptz, -- soft delete for GDPR erasure requests (Section 10.4)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_clients_fresha_id on public.clients(fresha_client_id) where deleted_at is null;
create index idx_clients_email on public.clients(email) where deleted_at is null;
create index idx_clients_mobile on public.clients(mobile) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Service categories — normalizes raw Fresha service names
-- ---------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  raw_service_name text not null unique, -- exact string as it appears in Fresha exports
  category text not null, -- 'colour' | 'cut' | 'chemical_treatment' | 'retail' | 'other'
  is_colour_category boolean not null default false, -- flags for top-up prediction logic (5.2 item 1)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Stock/Inventory management (Section 3.7, 5.14)
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text, -- e.g. 'bottle', 'tube', 'litre'
  reorder_threshold numeric(10,2), -- quantity at which a reorder is recommended
  current_estimated_stock numeric(10,2), -- manually updated periodic count, not real-time
  supplier text,
  -- Added 3 Sep 2026, both optional — power the "draft reorder message"
  -- one-tap action (a wa.me/mailto deep link pre-filled and ready to
  -- send, not an auto-send): without either, the action still generates
  -- the message text, just as a copy-to-clipboard instead of a live link.
  supplier_email text,
  supplier_phone text, -- E.164-ish digits, e.g. '447700900000' — wa.me needs no '+' or spaces
  approx_cost_per_unit numeric(10,2),
  is_critical boolean not null default false, -- flags service-blocking products for prioritization
  -- Soft-delete (added 30 Aug 2026) — mirrors stylists.employment_status:
  -- "removing" a product must stay safe against any open flags/
  -- service_product_usage history referencing it (Section 3.7's own stated
  -- requirement), so this is a status flip, never a hard delete. Real reads
  -- filter to is_active = true; historical flags/usage rows keep resolving
  -- to the same product id regardless.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_flags (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  urgency text not null default 'low', -- 'low' (getting low) | 'out' (completely out)
  flagged_by text, -- name/identifier, may not tie to a full user account (Section 13, Q18)
  status text not null default 'open', -- open | resolved
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Links services to estimated product consumption, powers the predictive
-- forecasting in Mechanism 2 (Section 3.7) — optional, populate as this
-- feature matures rather than requiring it complete from day one.
create table public.service_product_usage (
  id uuid primary key default gen_random_uuid(),
  raw_service_name text not null references public.service_categories(raw_service_name),
  product_id uuid not null references public.products(id) on delete cascade,
  estimated_quantity_per_service numeric(10,3), -- e.g. 0.05 (of a bottle) per appointment
  created_at timestamptz not null default now(),
  unique (raw_service_name, product_id)
);

-- ---------------------------------------------------------------------
-- Service catalog (Section 3.6, 5.11) — manually maintained price/duration
-- ---------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  raw_service_name text not null unique references public.service_categories(raw_service_name),
  -- price/duration_minutes made optional 4 Sep 2026 — pricing analysis
  -- moved to real per-stylist realized averages (actual net_sales/
  -- duration_minutes from fresha_appointments), not a manually-typed list
  -- price, so these two are no longer required. Still here as an optional
  -- manual override for a service with no real bookings yet.
  price numeric(10,2),
  duration_minutes integer,
  estimated_product_cost numeric(10,2), -- optional, rough estimate is fine — the one figure with no real data source, always manual
  is_estimate boolean not null default true, -- flags cost confidence per req. Section 5.11
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Appointments (Section 4.2)
-- ---------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  fresha_appointment_id text unique,
  client_id uuid references public.clients(id) on delete set null,
  stylist_id uuid references public.stylists(id) on delete set null,
  service_category_id uuid references public.service_categories(id),
  raw_service_name text, -- kept even if category mapping fails, for auditing
  appointment_date date not null,
  price numeric(10,2) not null default 0,
  retail_addon_amount numeric(10,2) default 0, -- if itemized in Fresha export (see req. Section 5.9 note)
  status text default 'completed', -- completed | cancelled | no_show
  created_at timestamptz not null default now()
);

create index idx_appointments_client on public.appointments(client_id);
create index idx_appointments_date on public.appointments(appointment_date);
create index idx_appointments_stylist on public.appointments(stylist_id);

-- ---------------------------------------------------------------------
-- Retail sales (Section 3.1, 5.9) — originally designed against an
-- assumed itemized-per-transaction retail report. Section 3.1's 19 Aug
-- 2026 update confirmed no report reviewed so far is shaped like this —
-- the real "Sales Summary by Type" report (below) is a period aggregate,
-- not itemized rows. Left in place (harmless, mock-data-only for now) in
-- case a future itemized report surfaces; real retail data currently
-- flows through `sales_summary_by_type` instead, not this table.
-- ---------------------------------------------------------------------
create table public.retail_sales (
  id uuid primary key default gen_random_uuid(),
  fresha_transaction_id text unique,
  stylist_id uuid references public.stylists(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null, -- nullable, may not always be captured
  product_name text,
  amount numeric(10,2) not null default 0,
  sale_date date not null,
  created_at timestamptz not null default now()
);

create index idx_retail_sales_stylist on public.retail_sales(stylist_id);
create index idx_retail_sales_date on public.retail_sales(sale_date);

-- Weekly retail conversion rate, salon-wide and per-stylist: distinct
-- retail-transaction count vs. distinct-client-visit count over the same
-- rolling week (Section 5.9's stated calculation method).
create view public.v_retail_conversion_weekly as
select
  date_trunc('week', a.appointment_date)::date as week_start,
  a.stylist_id,
  count(distinct a.client_id) filter (where a.status = 'completed') as clients_seen,
  count(distinct r.id) as retail_transactions,
  case
    when count(distinct a.client_id) filter (where a.status = 'completed') = 0 then null
    else round(
      count(distinct r.id)::numeric
      / count(distinct a.client_id) filter (where a.status = 'completed') * 100,
      1
    )
  end as retail_conversion_pct
from public.appointments a
left join public.retail_sales r
  on r.stylist_id = a.stylist_id
  and date_trunc('week', r.sale_date) = date_trunc('week', a.appointment_date)
group by date_trunc('week', a.appointment_date), a.stylist_id;

-- ---------------------------------------------------------------------
-- Fresha "Sales Summary" reports (Section 3.1, confirmed 19 Aug 2026) —
-- both are period-aggregate exports (one row per stylist, or per type,
-- for whatever date range was selected when the report was generated in
-- Fresha), not per-transaction rows — a genuinely different shape from
-- `appointments`/`retail_sales` above, not a variant of either. The
-- report's own CSV rows don't self-describe their date range, so
-- `period_start`/`period_end` are captured at upload time (the owner
-- picks the range the export covers), not parsed from the file.
-- ---------------------------------------------------------------------
create table public.sales_summary_by_team_member (
  id uuid primary key default gen_random_uuid(),
  team_member_name text not null, -- raw name as Fresha exports it — the source of truth even if matching below fails
  stylist_id uuid references public.stylists(id) on delete set null, -- resolved by name-match at commit time; null until/unless matched
  period_start date not null,
  period_end date not null,
  sales_qty numeric(10,2) not null default 0,
  items_sold numeric(10,2) not null default 0,
  gross_sales numeric(10,2) not null default 0,
  total_discounts numeric(10,2) not null default 0,
  refunds numeric(10,2) not null default 0,
  net_sales numeric(10,2) not null default 0,
  taxes numeric(10,2) not null default 0,
  total_sales numeric(10,2) not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_sales_summary_team_member_period on public.sales_summary_by_team_member(period_start, period_end);
create index idx_sales_summary_team_member_stylist on public.sales_summary_by_team_member(stylist_id);

-- The Service/Product split here is what resolves the retail-isolation
-- problem noted in Section 5.9 — "Sales Summary by Item" lumps services
-- and retail products together, this report doesn't. `type` is kept as
-- free text, not constrained to an enum: the real "Product" row content
-- was still unverified at review time (no retail sale had been logged
-- yet), so the exact value Fresha uses isn't confirmed.
create table public.sales_summary_by_type (
  id uuid primary key default gen_random_uuid(),
  type text not null, -- e.g. 'Service' | 'Product' — unconfirmed exact values, kept raw
  period_start date not null,
  period_end date not null,
  sales_qty numeric(10,2) not null default 0,
  items_sold numeric(10,2) not null default 0,
  gross_sales numeric(10,2) not null default 0,
  total_discounts numeric(10,2) not null default 0,
  refunds numeric(10,2) not null default 0,
  net_sales numeric(10,2) not null default 0,
  taxes numeric(10,2) not null default 0,
  total_sales numeric(10,2) not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_sales_summary_type_period on public.sales_summary_by_type(period_start, period_end);

-- ---------------------------------------------------------------------
-- Real appointment-list import (Requirements Section 3.1, confirmed 19
-- Aug 2026) — deliberately a SEPARATE table from the legacy `appointments`
-- table above, not a migration of it. `appointments` is shaped for the
-- mock warehouse (client_id/stylist_id FKs, a normalized status enum) and
-- is read throughout the entire insight-engine; the real Fresha export has
-- a fundamentally different shape (free-text client/stylist names, no
-- resolved IDs, a wider column set). Migrating `appointments` in place
-- would break every existing mock-data consumer. `appt_ref` is the first
-- genuinely stable ID confirmed from any Fresha report, so — unlike
-- `clients`, which has no such key — this table gets a real unique
-- constraint and a native upsert, not application-level dedup.
-- ---------------------------------------------------------------------
create table public.fresha_appointments (
  id uuid primary key default gen_random_uuid(),
  appt_ref text not null unique,
  client_name text not null, -- free text, not resolved to clients.id — see Requirements Section 3.1
  team_member_name text, -- free text, not resolved to stylists.id — no stable stylist ID exists in any Fresha report yet
  resource text,
  status text not null, -- New | Confirmed | Completed | Cancelled | No Show (Section 3.1) — kept as free text, not an enum
  created_date date,
  scheduled_date date,
  cancelled_date date,
  category text, -- Cuts & Styling | Colour Services | Treatments | Extensions (Section 3.1)
  service text,
  duration_minutes integer, -- parsed from Fresha's "1h 10min"-style text on import
  appt_slot text,
  created_by text,
  cancelled_by text,
  location text,
  net_sales numeric(10,2) not null default 0,
  cancellation_reason text,
  fees_charged numeric(10,2) not null default 0,
  prepayments numeric(10,2) not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_fresha_appointments_client on public.fresha_appointments(client_name);
create index idx_fresha_appointments_scheduled on public.fresha_appointments(scheduled_date);
create index idx_fresha_appointments_status on public.fresha_appointments(status);

-- ---------------------------------------------------------------------
-- Derived: per-client, per-category service history
-- Populated/refreshed by the insight engine (Section 5.1), not raw import
-- ---------------------------------------------------------------------
create table public.client_service_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id),
  last_visit_date date,
  avg_interval_days numeric(6,1), -- average days between visits for this category
  visit_count integer not null default 0,
  predicted_next_due_date date,
  lapse_risk_score numeric(5,2), -- 0-100, higher = more at risk
  confidence text default 'low', -- 'low' | 'medium' | 'high' — flags thin-history clients (req. Section 8)
  computed_at timestamptz not null default now(),
  unique (client_id, service_category_id)
);

create index idx_csh_client on public.client_service_history(client_id);
create index idx_csh_due_date on public.client_service_history(predicted_next_due_date);

-- ---------------------------------------------------------------------
-- Manual overrides for the colour-top-up-due / lapse-risk lists (Clients
-- tab) — added 23 Aug 2026. `client_name` -> `clients.full_name` matching
-- is exact-text (Section 3.1's own limitation): a client who genuinely
-- came in but got booked under a different name (a walk-in, a name
-- variant) never resolves, so the owner needs a manual "I checked, this
-- one's fine" override rather than a name-matching fix. Keyed by the real
-- `client_id` (post-match, not the raw name) + `insight_type` +
-- `category` — lapse-risk is tracked per real Fresha category, so a
-- client flagged in two categories at once needs two independently
-- dismissible rows, not one that silently covers both; colour-top-up has
-- no category axis of its own, so its rows always carry 'Colour Services'.
-- Clears automatically once a fresh, correctly-matched visit lands after
-- the dismissal (compared against `dismissed_at` at read time, not stored
-- here) — not a fixed expiry window and not permanent-until-manual, a
-- deliberate choice: it self-corrects for a genuine one-off mismatch and
-- degrades gracefully to effectively-permanent for a client whose bookings
-- chronically never match, without the owner having to guess upfront
-- which case they're in.
-- ---------------------------------------------------------------------
create table public.client_insight_dismissals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  insight_type text not null, -- 'colour-top-up' | 'lapse-risk'
  category text not null, -- real Fresha category text; always 'Colour Services' for colour-top-up
  note text, -- optional — "why" for future-owner-self, e.g. "came in 15th, booked under her husband's name"
  dismissed_at timestamptz not null default now(),
  unique (client_id, insight_type, category)
);

create index idx_cid_client on public.client_insight_dismissals(client_id);

-- ---------------------------------------------------------------------
-- Ad platform data (Section 3.2, 5.8 — blended CAC)
-- ---------------------------------------------------------------------
create table public.ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- 'meta' | 'google'
  campaign_id text,
  campaign_name text,
  spend_date date not null,
  spend_amount numeric(10,2) not null default 0,
  platform_reported_conversions integer default 0, -- labelled clearly as platform-reported per GDPR/data-integrity note (Section 8)
  synced_at timestamptz not null default now(),
  -- Real fallback path (added 3 Sep 2026) — the live Meta token has already
  -- broken once (an app-review/Business-verification gate, not something
  -- fixable in-app), so a manual CSV-export upload exists as a standing
  -- backup, not a one-off. 'csv_import' rows are always the lowest
  -- precedence — see `v_ad_spend_daily_effective` below, which every real
  -- consumer of ad spend reads through instead of this raw table, so the
  -- "live sync always wins" rule only has to be correct in one place.
  source text not null default 'meta_api', -- 'meta_api' | 'manual' | 'csv_import'
  unique (platform, campaign_id, spend_date)
);

create index idx_ad_spend_date on public.ad_spend_daily(spend_date);
create index idx_ad_spend_platform on public.ad_spend_daily(platform);

-- Blended CAC is computed, not stored raw — see insight_engine views below.

-- ---------------------------------------------------------------------
-- Business indicator framework (Section 5.13) — "quant-style" signals,
-- stored per computation so trend direction is real history, not guessed
-- ---------------------------------------------------------------------
create type indicator_status as enum ('strong', 'neutral', 'caution');
create type indicator_trend as enum ('improving', 'stable', 'declining');

create table public.business_indicators (
  id uuid primary key default gen_random_uuid(),
  indicator_key text not null, -- 'hiring_signal' | 'pricing_signal' | 'marketing_spend_signal' | 'retention_health_signal'
  computed_at timestamptz not null default now(),
  status indicator_status not null,
  trend indicator_trend,
  confidence text default 'low', -- 'low' | 'medium' | 'high', same pattern as client_service_history
  current_values jsonb not null, -- the actual numbers driving this read, e.g. {"utilization_pct": 95, "weeks_at_capacity": 6}
  reasoning text, -- LLM-generated plain-language explanation, grounded in current_values only
  created_at timestamptz not null default now()
);

create index idx_indicators_key_date on public.business_indicators(indicator_key, computed_at desc);

-- ---------------------------------------------------------------------
-- Industry benchmark knowledge base (Section 3.4) — owner-curated
-- ---------------------------------------------------------------------
create table public.industry_benchmarks (
  id uuid primary key default gen_random_uuid(),
  topic text not null, -- 'marketing' | 'pricing' | 'retention' | 'staffing' | 'cac' | 'aov' | etc.
  principle text not null, -- the general principle, in owner's own words
  application_notes text, -- owner's specific reasoning for their salon
  target_metric text, -- e.g. 'cac_ceiling_pct_of_avg_ticket'
  target_value numeric(10,2), -- e.g. the actual benchmark % once researched (req. open Q14)
  source_note text, -- where this came from, kept generic — never store copyrighted excerpts here
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- AI recommendations & outcome logging (Section 5.3, 5.5, 5.8, 5.9)
-- ---------------------------------------------------------------------
create type recommendation_status as enum ('pending', 'in_progress', 'accepted', 'rejected', 'dismissed');

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  category text not null, -- 'colour_topup' | 'lapse_risk' | 'ad_spend' | 'cac' | 'aov' | 'stylist_profitability' | 'expansion_signal'
  title text not null, -- short actionable summary for the to-do list (Section 5.5)
  detail text, -- fuller LLM-generated narrative
  priority_score numeric(6,2) not null default 0, -- drives to-do list ranking
  estimated_impact_gbp numeric(10,2), -- £ opportunity/impact shown front-and-centre on the to-do list (Section 5.5)
  impact_confidence text default 'medium', -- 'low' | 'medium' | 'high' — honesty framing alongside the £ figure
  related_client_id uuid references public.clients(id) on delete set null,
  related_stylist_id uuid references public.stylists(id) on delete set null,
  status recommendation_status not null default 'pending',
  notes text, -- free-text owner notes (e.g. why it's "waiting", what was actually done) — feeds chat memory (5.4.1)
  rejection_reason text, -- captured for the memory/feedback loop (Section 5.4.1, 5.3)
  cycle_date date not null, -- which weekly insight cycle this belongs to
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index idx_recommendations_status on public.recommendations(status);
create index idx_recommendations_cycle on public.recommendations(cycle_date);

-- Added for Stage 4's real insert-per-cycle-with-carry-forward write path
-- (`warehouse-write`'s `recommendations`/`sync_cycle` action): `category`
-- doubles as the stable cross-cycle key (e.g. 'lapse-risk::flagged') that
-- the carry-forward lookup and the read-side latest-per-key dedupe both
-- query on, so it needs an index too. `urgency` mirrors
-- `RankedRecommendation.urgency` ('this-week' | 'soon' | 'monitor') —
-- computed at candidate-build time, not derivable from the other stored
-- columns, but needed so Chat's operational-memory read (which never
-- recomputes candidates) can still report it accurately.
alter table public.recommendations add column if not exists urgency text;
create index if not exists idx_recommendations_category on public.recommendations(category);

-- ---------------------------------------------------------------------
-- Chat memory (Section 5.4.1) — structured, not raw chat logs
-- ---------------------------------------------------------------------
create table public.chat_memory_facts (
  id uuid primary key default gen_random_uuid(),
  fact_type text not null, -- 'correction' | 'preference' | 'historical_outcome'
  subject text not null, -- e.g. 'stylist:uuid', 'general', 'cac'
  content text not null, -- the actual fact, in plain text
  source_conversation_ref text, -- optional pointer back to originating chat session
  created_at timestamptz not null default now(),
  expires_at timestamptz -- optional TTL for retention policy (Section 10.6)
);

-- ---------------------------------------------------------------------
-- Import audit log (Section 4.3, 3.1) — every manual Fresha upload
-- ---------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  report_type text not null, -- 'client_list' | 'sales_summary_by_team_member' | 'sales_summary_by_type' | 'sales_appointments' (unconfirmed shape, not yet built) | etc.
  uploaded_by uuid references public.profiles(id),
  file_name text,
  row_count integer,
  error_count integer default 0,
  validation_errors jsonb, -- array of {row, field, message}
  status text not null default 'pending', -- pending | committed | failed
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

-- ---------------------------------------------------------------------
-- GDPR: Record of Processing Activities support table (Section 10.1)
-- Simple structured log, not a substitute for the actual ROPA document
-- ---------------------------------------------------------------------
create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null, -- 'access' | 'erasure' | 'rectification' | 'objection'
  client_id uuid references public.clients(id),
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  notes text
);

-- =====================================================================
-- Row Level Security (Section 5.7, 8.1, 10.8)
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.stylists enable row level security;
alter table public.stylist_wages enable row level security;
alter table public.stylist_hours enable row level security;
alter table public.stylist_working_pattern enable row level security;
alter table public.stylist_leave enable row level security;
alter table public.product_costs enable row level security;
alter table public.clients enable row level security;
alter table public.job_applicants enable row level security;
alter table public.vacancies enable row level security;
alter table public.services enable row level security;
alter table public.retail_sales enable row level security;
alter table public.sales_summary_by_team_member enable row level security;
alter table public.sales_summary_by_type enable row level security;
alter table public.products enable row level security;
alter table public.stock_flags enable row level security;
alter table public.service_product_usage enable row level security;
alter table public.appointments enable row level security;
alter table public.fresha_appointments enable row level security;
alter table public.client_service_history enable row level security;
alter table public.client_insight_dismissals enable row level security;
alter table public.ad_spend_daily enable row level security;
alter table public.industry_benchmarks enable row level security;
alter table public.business_indicators enable row level security;
alter table public.recommendations enable row level security;
alter table public.chat_memory_facts enable row level security;
alter table public.import_batches enable row level security;
alter table public.data_subject_requests enable row level security;

-- Helper: get current user's role
create or replace function public.current_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Owner & manager can read most operational tables; wages are owner-only.
create policy "owner_manager_read_clients" on public.clients
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_recruitment" on public.job_applicants
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_vacancies" on public.vacancies
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_appointments" on public.appointments
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_fresha_appointments" on public.fresha_appointments
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_services" on public.services
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_retail_sales" on public.retail_sales
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_sales_summary_team_member" on public.sales_summary_by_team_member
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_sales_summary_type" on public.sales_summary_by_type
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_products" on public.products
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

-- Stock flags intentionally readable/insertable more broadly than most
-- tables — this is the point of Mechanism 1 (Section 3.7): staff need a
-- fast way to flag low stock without full portal access. Refine this
-- policy once Section 13 Q18 (staff access method) is resolved.
create policy "stock_flags_broad_insert" on public.stock_flags
  for insert with check (true);

create policy "owner_manager_stock_flags_manage" on public.stock_flags
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_stock_flags_update" on public.stock_flags
  for update using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_service_product_usage" on public.service_product_usage
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_history" on public.client_service_history
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_insight_dismissals" on public.client_insight_dismissals
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_ads" on public.ad_spend_daily
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_read_recommendations" on public.recommendations
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

-- Wages: owner-only, per Section 5.7 and 10.7
create policy "owner_only_wages" on public.stylist_wages
  for all using (public.current_user_role() in ('owner', 'admin'));

-- Contracted hours aren't pay data — broader owner+manager access, same as
-- most other operational tables (employment_status/start_date on
-- `stylists` itself follow the same pattern), not the wage-specific
-- owner-only restriction above.
create policy "owner_manager_stylist_hours" on public.stylist_hours
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

-- Working pattern and leave: same broader owner+manager access as
-- stylist_hours, not the wage-specific owner-only restriction — neither is
-- pay data.
create policy "owner_manager_stylist_working_pattern" on public.stylist_working_pattern
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_manager_stylist_leave" on public.stylist_leave
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "owner_only_costs" on public.product_costs
  for all using (public.current_user_role() in ('owner', 'admin'));

-- Stylist self-scoped view (Phase 2+, Section 5.7) — a stylist can only
-- see their own linked profitability/utilization data, never others'.
-- This policy is a placeholder shape — refine once Section 5.7 fields
-- (targets, pay tiers) are finalized.
create policy "stylist_self_only" on public.stylists
  for select using (
    public.current_user_role() in ('owner', 'manager', 'admin')
    or id = (select linked_stylist_id from public.profiles where id = auth.uid())
  );

-- Admin/owner full access to import + benchmark + memory tables
create policy "admin_owner_imports" on public.import_batches
  for all using (public.current_user_role() in ('owner', 'admin'));

create policy "admin_owner_benchmarks" on public.industry_benchmarks
  for all using (public.current_user_role() in ('owner', 'admin'));

create policy "owner_manager_indicators" on public.business_indicators
  for select using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "admin_owner_memory" on public.chat_memory_facts
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

create policy "admin_owner_dsr" on public.data_subject_requests
  for all using (public.current_user_role() in ('owner', 'admin'));

create policy "users_read_own_profile" on public.profiles
  for select using (id = auth.uid() or public.current_user_role() in ('owner', 'admin'));

-- =====================================================================
-- Views: derived metrics referenced directly in requirements Section 5.8
-- =====================================================================

-- Blended CAC by calendar month — total spend (Meta+Google) / new clients.
-- "New client" = first_appointment_date falling in the month, not
-- added_date — Requirements Section 5.8's own worked example defines a new
-- client as "first-ever appointment recorded... within the period", not
-- record-creation date. added_date can precede (or entirely lack) an
-- actual visit — e.g. a phone inquiry or online profile that never
-- converts — and counting those would inflate this denominator and make
-- CAC read artificially low. Decided 20 Aug 2026 (superseding this view's
-- original added_date-based definition, written before first_appointment_date
-- existed as a confirmed, separate field).
-- Source-precedence resolution (added 3 Sep 2026) — real per-day spend,
-- picking whichever source actually matters: any real 'meta_api' or
-- 'manual' row for a (date, platform) always wins outright; a
-- 'csv_import' row only counts when NEITHER of those exists for that same
-- (date, platform), i.e. csv_import only ever fills a genuine gap, never
-- overrides or double-counts a day the live sync (or a deliberate manual
-- correction) already covers. Every real consumer of ad spend — this CAC
-- view, the trailing-30-day figure, Chat's marketing context — reads
-- through this view, not the raw table, so this is the only place the
-- precedence rule is expressed.
create or replace view public.v_ad_spend_daily_effective as
with priority_days as (
  select distinct spend_date, platform
  from public.ad_spend_daily
  where source != 'csv_import'
)
select
  a.spend_date,
  a.platform,
  sum(a.spend_amount) as effective_spend
from public.ad_spend_daily a
where a.source != 'csv_import'
   or not exists (
     select 1 from priority_days p
     where p.spend_date = a.spend_date and p.platform = a.platform
   )
group by a.spend_date, a.platform;

create or replace view public.v_blended_cac_monthly as
with monthly_spend as (
  select date_trunc('month', spend_date)::date as month,
         sum(effective_spend) as total_spend
  from public.v_ad_spend_daily_effective
  group by 1
),
monthly_new_clients as (
  select date_trunc('month', first_appointment_date)::date as month,
         count(*) as new_client_count
  from public.clients
  where deleted_at is null and first_appointment_date is not null
  group by 1
)
select
  coalesce(s.month, c.month) as month,
  coalesce(s.total_spend, 0) as total_ad_spend,
  coalesce(c.new_client_count, 0) as new_clients,
  case when coalesce(c.new_client_count, 0) > 0
       then round(coalesce(s.total_spend, 0) / c.new_client_count, 2)
       else null
  end as blended_cac
from monthly_spend s
full outer join monthly_new_clients c on s.month = c.month
order by 1 desc;

-- AOV by month, salon-wide
-- Points at `fresha_appointments` (real import), not the legacy mock
-- `appointments` table — same class of fix `v_blended_cac_monthly` needed.
--
-- Fixed 6 Sep 2026: the original version (20 Aug 2026) averaged net_sales
-- per ROW, on the wrong assumption that one row = one whole client visit.
-- It doesn't — Fresha's real export gives one row per SERVICE BOOKED, so a
-- single real visit with Toner + Full Head Foils + Cut & Finish shows up
-- as three rows, each with only its own service's price. That silently
-- halved the real AOV (confirmed against real Sep 2026 bookings: £42.97
-- shown vs £81.65 real, averaged per visit). A real visit has no shared
-- booking/order ID in Fresha's export, so (client_name, scheduled_date) is
-- the best available real-visit key — two genuinely separate same-day
-- visits by the same client would merge under this; accepted as rare.
-- Status filter uses the real confirmed value `'Completed'` (capital C),
-- not the mock table's lowercase `'completed'`.
create or replace view public.v_aov_monthly as
with per_visit as (
  select client_name, scheduled_date, sum(net_sales) as visit_total
  from public.fresha_appointments
  where status = 'Completed' and scheduled_date is not null
  group by client_name, scheduled_date
)
select
  date_trunc('month', scheduled_date)::date as month,
  round(avg(visit_total), 2) as avg_order_value,
  count(*) as appointment_count
from per_visit
group by 1
order by 1 desc;

-- Profit per chair-hour by service (requirements Section 5.11)
-- Uses salon-average hourly rate for a simple first-pass MVP calculation —
-- per-stylist variants (where the same service is priced differently by
-- stylist skill/rate) can be added as a refinement once this is validated.
create or replace view public.v_service_profitability as
with avg_hourly_rate as (
  select avg(hourly_rate) as rate
  from public.stylist_wages
  where effective_to is null -- current rates only
)
select
  s.raw_service_name,
  s.price,
  s.duration_minutes,
  s.estimated_product_cost,
  s.is_estimate,
  round(
    (s.price
      - coalesce(s.estimated_product_cost, 0)
      - (coalesce((select rate from avg_hourly_rate), 0) * (s.duration_minutes / 60.0))
    ) / (s.duration_minutes / 60.0),
    2
  ) as profit_per_chair_hour,
  count(a.id) as booking_count_90d
from public.services s
left join public.appointments a
  on a.raw_service_name = s.raw_service_name
  and a.appointment_date >= (current_date - interval '90 days')
  and a.status = 'completed'
group by s.raw_service_name, s.price, s.duration_minutes, s.estimated_product_cost, s.is_estimate
order by profit_per_chair_hour asc;

-- =====================================================================
-- Daily digest schedule (added 3 Sep 2026)
-- =====================================================================
-- Pushes a proactive email once a day via the `daily-digest` Edge
-- Function, instead of leaving every insight (stock flags, CAC drift) as
-- something that only helps if someone remembers to open the app.
--
-- The two secrets `net.http_post` needs below (the anon key, to satisfy
-- the Edge Function gateway's own JWT check, and a shared x-app-secret
-- matching the function's `DIGEST_SHARED_SECRET`) are NOT set by this
-- file — they're created once via `vault.create_secret(value, name)`,
-- run directly against the live database, never checked into git. This
-- file only re-runs safely: it references those vault secrets by name.
--
-- Schedule is UTC-fixed, not timezone-aware — 06:00 UTC lands at 7am UK
-- time during BST (spring–October) and 6am during GMT (winter). A known,
-- disclosed simplification for v1, not an oversight.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'daily-digest',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://yimtohrunyzkxdrlhhcr.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_anon_key'),
      'x-app-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_shared_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- =====================================================================
-- MedLocks retail product line (added 5 Sep 2026)
-- =====================================================================
-- A genuinely separate business function from the salon-services domain
-- above: MedLocks' own manufactured hair-care product line (currently one
-- SKU — a hand-mixed glass-blonde hair serum — with real ambition to
-- scale to multiple SKUs and real distribution). Deliberately its own
-- tables, not bolted onto `public.products` above — that table is salon
-- *operational stock* (colour, chemicals, retail items the salon uses/
-- sells in-salon), a different thing from a manufactured SKU with a real
-- recipe, batch cost, and compliance status. Sharing a name ("product")
-- is not sharing a domain.
--
-- Cost-per-unit is fully dynamic, never a number typed in directly: an
-- ingredient's cost is derived from what it was actually bought for
-- (purchase_price / purchase_quantity), and a SKU's cost is the real sum
-- of its recipe — change one ingredient's price and every SKU using it
-- recomputes, rather than needing every affected SKU's price hand-edited.
-- Packaging (bottle, cap, label) is modelled as an ordinary recipe
-- ingredient, not a separate concept — it's incurred making the unit
-- regardless of sales channel. Postage/shipping packaging is kept
-- separate on the SKU itself, since it's only a real cost for the online
-- channel, never for an in-salon walk-in sale.
create table public.retail_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purchase_price numeric(10,2) not null, -- what was actually paid for one purchase batch
  purchase_quantity numeric(10,4) not null, -- how much that purchase batch contained, in `unit`
  unit text not null, -- 'ml' | 'g' | 'each' — whatever the ingredient is naturally measured in
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.retail_skus (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- e.g. 'Glass Blonde Hair Serum'
  description text,
  in_salon_price numeric(10,2),
  online_price numeric(10,2),
  -- Postage + shipping packaging (mailer, tape, courier/postage cost) for
  -- one unit sold online — deliberately NOT part of the recipe below,
  -- since an in-salon sale never incurs it.
  shipping_packaging_cost numeric(10,2),
  -- Added 5 Sep 2026 for wholesale/retail-distribution readiness — the
  -- % a wholesale/retail partner would expect off online_price (their
  -- resale RRP). 0.5 (50% off) is a stated, industry-typical default
  -- (same "stated assumption, not hidden" pattern as TARGET_MARGIN_PCT
  -- elsewhere), editable per SKU as real wholesale terms become known.
  wholesale_discount_pct numeric(5,4) not null default 0.5,
  -- Added 5 Sep 2026 — real production ceiling at Blake's current
  -- (part-time, hand-mixing) effort level, and a free-text note on what
  -- happens beyond it, in his own words rather than a fabricated second
  -- number: he can go full-time and scale into the "1000s/week" once
  -- demand requires it, but that's a step-change decision, not a fixed
  -- ceiling to compute against.
  weekly_capacity_units integer,
  capacity_scale_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The formula: which ingredients, and how much of each, go into one unit
-- of a SKU. `quantity_used` is in the ingredient's own `unit` — a 50ml
-- serum using 45ml of a base oil ingredient stores quantity_used = 45.
create table public.retail_recipe_items (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.retail_skus(id) on delete cascade,
  ingredient_id uuid not null references public.retail_ingredients(id) on delete cascade,
  quantity_used numeric(10,4) not null,
  created_at timestamptz not null default now(),
  unique (sku_id, ingredient_id) -- re-adding the same ingredient to a recipe updates its quantity, not a duplicate line
);

-- Real known pack-size price tiers per ingredient (added 6 Sep 2026) —
-- lets the app spot when real usage at capacity would burn through the
-- currently-selected pack size fast enough that a bigger, cheaper-per-unit
-- tier is worth switching to. Sourced from the real supplier product pages
-- (Fizzy Whiz / The Soap Kitchen) at the time each was entered — a
-- supplier's own price list, not a live-syncable feed, so these go stale
-- over time same as the ingredient's own purchase_price/purchase_quantity.
create table public.retail_ingredient_price_tiers (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.retail_ingredients(id) on delete cascade,
  purchase_price numeric(10,2) not null,
  purchase_quantity numeric(10,4) not null,
  unit text not null, -- must match the ingredient's own `unit` to be comparable
  source_url text,
  created_at timestamptz not null default now()
);

-- Real production run log (added 6 Sep 2026) — doubles as the batch
-- records the label-compliance and Product Information File requirements
-- (see `retail_compliance_steps`) expect to exist, not just a nice-to-have
-- running count.
create table public.retail_production_batches (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.retail_skus(id) on delete cascade,
  batch_number text not null,
  produced_date date not null,
  quantity_made integer not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (sku_id, batch_number)
);

-- Real fixed monthly overhead + cash reserves (added 6 Sep 2026, per
-- direct request — "how much risk we carry... if we need to reel in").
-- Singleton table (always exactly one row, fixed id) — a handful of real
-- numbers only the owner knows, edited occasionally like a settings page,
-- not a history to track over time. This is what turns the Business Risk
-- Meter's "cash runway — not tracked" disclosure into a real number: real
-- trailing revenue minus real wage/product cost minus this overhead,
-- divided into these real cash reserves.
create table public.business_overhead (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  monthly_rent numeric(10,2) not null default 0,
  monthly_insurance numeric(10,2) not null default 0,
  monthly_loan_repayments numeric(10,2) not null default 0,
  monthly_other_fixed_costs numeric(10,2) not null default 0,
  cash_reserves numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- Debt/investment decision justifier (added 6 Sep 2026, per direct
-- request — "the app should justify and rationalise... until we have a
-- bulletproof plan the app says no, and even then risk meter goes up").
-- Real, computed verdicts, never a fabricated yes/no: `debtDecision.ts`
-- checks a proposed monthly repayment against the SAME real operating
-- cash flow + overhead the Risk Meter already uses. `repayment_plan` is
-- required free text (how it'll actually be covered) — the app can judge
-- whether current real numbers already support it, but can't verify a
-- future plan will materialize, and says so honestly either way. Once a
-- decision is marked 'committed', its monthly_repayment flows straight
-- into the Risk Meter's real cash-runway calc — taking on debt visibly
-- raises real risk, automatically, not just in a one-off comment.
create table public.business_debt_decisions (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  amount numeric(10,2) not null,
  funding_type text not null, -- 'debt' | 'personal_money'
  interest_rate_pct numeric(5,2),
  term_months integer,
  monthly_repayment numeric(10,2) not null default 0, -- required > 0 for 'debt'; always 0 for 'personal_money' (a one-time injection, not a recurring cost)
  repayment_plan text not null,
  status text not null default 'proposed', -- 'proposed' | 'committed' | 'rejected'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Path to £1M valuation goal (added 6 Sep 2026, per direct request — "a
-- tracker to ultimate goal of 1 million company value by 2030"). Singleton
-- row (fixed id), seeded with Blake's own stated figures. The multiple
-- range is a real, sourced small-salon valuation heuristic (1.15x-2.8x SDE
-- depending on transferability/staff stability — see `valuationGoal.ts`'s
-- own doc comment for the exact sources), not a professional appraisal —
-- editable here if a real one is ever obtained. "Current valuation" is
-- never shown as a single fake-precise number: always a low/high range
-- from real trailing operating profit × this multiple range.
create table public.business_goal (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  target_valuation numeric(12,2) not null default 1000000,
  target_date date not null default '2030-12-31',
  valuation_multiple_low numeric(4,2) not null default 1.5,
  valuation_multiple_high numeric(4,2) not null default 2.5,
  updated_at timestamptz not null default now()
);

-- Real UK cosmetic-product legal requirements before a product can be sold
-- (added 6 Sep 2026) — sourced from the Office for Product Safety and
-- Standards' SCPN regime (UK Cosmetic Products Enforcement Regulations
-- 2013): stability testing, preservative efficacy testing, a CPSR from a
-- qualified safety assessor, a Product Information File, a UK Responsible
-- Person, SCPN notification, and compliant labelling. The fixed step
-- definitions (title/description) live in frontend code as real,
-- source-cited facts, not owner data — this table only tracks completion
-- per SKU, since the same product only needs each step done once.
create table public.retail_compliance_steps (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.retail_skus(id) on delete cascade,
  step_key text not null,
  completed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  unique (sku_id, step_key)
);

alter table public.retail_ingredients enable row level security;
alter table public.retail_skus enable row level security;
alter table public.retail_recipe_items enable row level security;
alter table public.retail_compliance_steps enable row level security;
alter table public.retail_ingredient_price_tiers enable row level security;
alter table public.retail_production_batches enable row level security;
alter table public.business_overhead enable row level security;
alter table public.business_debt_decisions enable row level security;
alter table public.business_goal enable row level security;

create policy "owner_manager_retail_ingredients" on public.retail_ingredients
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_retail_skus" on public.retail_skus
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_retail_recipe_items" on public.retail_recipe_items
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_retail_compliance_steps" on public.retail_compliance_steps
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_retail_ingredient_price_tiers" on public.retail_ingredient_price_tiers
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_retail_production_batches" on public.retail_production_batches
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_business_overhead" on public.business_overhead
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_business_debt_decisions" on public.business_debt_decisions
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));
create policy "owner_manager_business_goal" on public.business_goal
  for all using (public.current_user_role() in ('owner', 'manager', 'admin'));

-- =====================================================================
-- End of schema v1
-- =====================================================================