# Salon AI Command Centre — Requirements Document

## 1. Product Vision

A proprietary, back-end AI system that turns raw salon operational and marketing data into actionable insight and recommendations for the owner and salon manager. Not client-facing. Not a booking or chat tool. A management intelligence layer that:

- Predicts when colour/chemical clients are due a top-up, based on real service history rather than generic time-lapse rules
- Flags clients at risk of lapsing before Fresha's own generic tags would catch them
- Feeds automated, precisely-timed marketing sends (email/SMS via Mailchimp)
- Gives the owner/manager a conversational dashboard to query salon performance, marketing spend, and client trends in plain language
- Recommends (does not auto-execute) ad spend and marketing adjustments across Meta, Google, and SEO
- Compounds in value over time as data volume and history grow, creating a moat competitors can't easily replicate

**Explicitly out of scope:** AI phone answering, AI booking, client-facing AI photo generation, consultation app integration (parked — low expected value, not currently used consistently by stylists).

---

## 2. Users & Roles

| Role | Access |
|---|---|
| Owner (you) | Full access — dashboard, chat, all reports, settings, ability to approve/reject AI recommendations, manage data sources, manage budgets/thresholds |
| Salon Manager | Dashboard, chat, reports, recommendation approval (permission-gated, TBD if full or limited) |
| Employee/Stylist (Phase 2+) | Narrow, self-scoped view only — see Section 5.7 |
| System/Admin (dev) | Data pipeline config, API keys, schema, logs, monitoring — this is you in developer mode, ideally separated from "manager" UI |

**Open question:** Does the manager get equal approval rights to you, or view + suggest only? Recommend deciding before build.

---

## 3. Data Sources & Ingestion

### 3.1 Fresha (MVP: manual weekly export)
- **Method:** Manual CSV export by owner/manager, uploaded via a real upload UI in the app (not raw file-drop into Supabase)
- **Confirmed report structures (from real exports reviewed 19 Aug 2026 — replaces earlier assumptions below where they conflict):**
  - **Client list export** — columns: `Client, Gender, Age, Mobile number, Email, Added on, First appt., Last appt., Loyalty points balance, Loyalty tier, Client source, Referred by`. Dates in `"14 Nov 2025, 12:00am"` format (needs parsing to ISO on import). `Age` and `Loyalty tier` frequently blank — treat as nullable, not a validation failure.
  - **Sales Summary — by Team Member** — columns: `Team member, Sales qty, Items sold, Gross sales, Total discounts, Refunds, Net sales, Taxes, Total sales`. One row per stylist, aggregated over the report's date range.
  - **Sales Summary — by Item** — same metric columns, keyed by `Item` instead of `Team member`. **Important confirmed finding:** this report is not retail-specific — it lists services (e.g. "Cut & Finish," "Balayage") and retail products in the same list under one generic `Item` column. Cannot be used alone to isolate retail sales.
  - **Sales Summary — by Type** — same metric columns, keyed by `Type`. **This is the one that resolves the retail-isolation problem** — confirmed to have a Service/Product split dimension (verified structurally; salon hadn't logged a retail sale yet at time of review, so real "Product" row content is still unconfirmed — re-verify once at least one retail sale has been rung through Fresha).
  - **Appointment list export (confirmed 19 Aug 2026 — resolves the gap flagged below)** — columns: `Appt. ref., Client, Team member, Resource, Status, Created date, Scheduled date, Cancelled date, Category, Service, Duration (mins), Appt. slot, Created by, Cancelled by, Location, Net sales, Cancellation reason, Fees charged, Prepayments`. One row per individual appointment — this is the row-per-booking detail the rest of Section 5's per-client insight logic (colour top-up, lapse risk) depends on.
    - **`Appt. ref.` is a genuine stable ID** — unlike the client list (no ID at all, dedup on email/mobile) or team member/service names (text-only, no ID), this can be used as a real primary key for appointment records.
    - **`Status` values confirmed:** `New, Confirmed, Completed, Cancelled, No Show`. Filtering to `Completed` gives actual attended appointments — this is what resolves the retail-conversion denominator gap: distinct `Client` values among `Completed` appointments with `Scheduled date` in a given period is exactly "distinct clients seen in period X" from Section 5.9's formula.
    - **`Category` values confirmed:** `Cuts & Styling, Colour Services, Treatments, Extensions` — maps directly to the broad service-categorization concept in Section 4.2/`service_categories`.
    - **`Duration (mins)` is actually text** (e.g. `"1h 0min"`, `"1h 10min"`), not a raw number — needs parsing on import despite the column name implying minutes.
    - **No retail items appear in this report** — consistent with the earlier finding that retail sales live only in the Sales Summary by Type report, not mixed into appointments. The two reports serve genuinely different purposes and both are needed.
    - **`Team member` is still name-only, no stable ID** — same limitation as the Sales Summary reports; stylist matching still depends on name-matching against a real roster once one exists (see the `stylist_id` note below).
  - **Known gap, not yet resolved:** none of the reports reviewed so far cross Team Member × Type — i.e. there's no confirmed report giving "retail sales, per stylist" directly. Section 5.9's per-stylist retail conversion rate depends on this. Check Fresha's report builder for a filter/breakdown option combining both dimensions before assuming a workaround is needed.
- **Note:** since this is a "boatload of reports" rather than one clean export, the upload UI needs to support multiple report types per session, each mapped to its own parser/validator — not a single generic CSV importer. Build one adapter per report type (fits the modular adapter pattern in Section 7).
- **Cadence:** Weekly at MVP. Design ingestion so cadence is configurable (daily/weekly) with zero code change when you upgrade to the paid live connector later.
- **Validation on upload:** Detect duplicate clients, missing key fields (email/phone), malformed dates, and flag to user before committing to warehouse — bad data silently entering the system is the #1 long-term risk.
- **Future/Phase 2:** Fresha official Data Connector API (£190/month) — live sync, same downstream schema, swap ingestion method only.

### 3.2 Ad Platforms (MVP: live API)
- **Meta Ads API** — spend, campaign performance, conversions (with the caveat that platform-reported conversions are known to be inflated/overlapping — see Section 8, non-functional/data integrity)
- **Google Ads API** — spend, campaign performance, keywords, quality score
- **Cadence:** Daily sync minimum, ideally near-real-time
- **Auth:** OAuth per platform, refresh token handling, alerting on token expiry (this breaks silently in most systems — must be monitored)
- **Manual fallback for a platform not yet live (New):** Google Ads API access is currently blocked on Developer Token approval (requires a Manager Account, applied for separately from Meta). Rather than leaving CAC/blended-spend metrics (Section 5.8) sitting empty in the meantime, a simple manual entry screen lets the owner input basic daily/period figures (spend, date, platform) by hand, writing into the same `ad_spend_daily` table the live API would populate. Same principle as Section 3.5's manual cost input — a manual stopgap that gets fully replaced by the live adapter later with zero schema change, not a separate parallel system. Once Google's API is actually connected, manual entries for that platform simply stop being needed going forward; historical manually-entered rows stay as-is.

### 3.3 SEO & Local Search (MVP-worthy, free data sources available)
Reframed from the original vague "SEMrush or equivalent" placeholder — for a single-location local business, Google's own free APIs cover most of what actually matters, no paid SEO tool subscription required at MVP.

- **Google Search Console API** — free, official. Provides organic search performance: which queries bring people to the site, click-through rate, average position, page-level performance. Far more capable than the web dashboard (full programmatic history vs. the 1,000-row/16-month cap on the manual interface).
- **Google Business Profile (GBP) API** — free for normal small-business usage, and arguably more important than generic organic SEO for a local salon, since local pack/Maps visibility usually drives more real foot traffic than organic blog-style search ever will. Covers: review volume and sentiment, business info accuracy/completeness, Q&A, performance insights (views, calls, direction requests generated from the listing).
- **Setup lead time — start this early:** GBP API access requires a Google Cloud project, a verified profile active 60+ days, a valid business website, and manual Google approval that can take days to weeks. Apply for access as soon as the build starts, don't leave it until this module is being built, or it'll sit blocked waiting on Google.
- **Phase 2, optional:** a paid tool (SEMrush, Ahrefs, etc.) for competitor keyword tracking and backlink analysis — genuinely useful eventually, but not needed to generate real, actionable insight at MVP given a single local salon's SEO needs are dominated by local search factors, not broad organic competition.

### 3.4 Industry Benchmark Knowledge Base (Phase 2, but design for it now)
- Curated, static-ish reference data: industry-standard retention rates, staffing ratios, pricing benchmarks, seasonal demand patterns for hairdressing specifically
- Not live-synced — periodically updated by you
- Used to give AI comparative context ("your retention is X%, industry standard for a salon your size is Y%") rather than judging your numbers in isolation
- **Needs a defined source list** — this is manually curated, so requirements should include: where does this data come from, how is it verified, how often is it refreshed
- **Content sources to curate in:** salon-specific operational/business best practice material (e.g. Salon Jedi-type frameworks — pricing structures, client retention playbooks, staff KPIs), plus general business scaling/profitability frameworks (e.g. Alex Hormozi-style offer, pricing, and growth principles) where they generalize to a service business
- **Important constraint:** this must be *your* summarized/paraphrased notes and frameworks entered as structured reference text, not copyrighted book content reproduced or uploaded wholesale — feed the AI the underlying principles and heuristics you want it to reason with, not scanned/pasted book text
- Treat this as a living internal "salon playbook" document you maintain and expand over time, versioned like anything else in the warehouse

### 3.5 Manual Cost & Wage Input (New)
- **Product/COGS spend:** manual input screen (not Fresha-derived, unless the Inventory report covers it) for product costs — needed to calculate true service profitability, not just revenue
- **Stylist wages:** manual input per stylist — **confirmed hourly pay model** (Section 13, Q8), so this is just a rate per stylist rather than needing to support salary/commission variants. Kept in its own protected table given sensitivity of pay data.
- **Purpose:** combine wage + product cost data with Fresha revenue-per-stylist data to calculate real profitability per stylist, not just bookings volume — enables:
  - Profitability ranking per stylist (revenue generated vs. cost to employ)
  - Data-backed raise/target conversations (e.g. "stylist X needs to hit £Y/month in bookings to justify a raise to £Z")
  - Flagging under- or over-utilized stylists (fully booked and profitable vs. quiet and costly)
- **Access control:** wage data is sensitive — likely owner-only visibility, even if manager has broader dashboard access elsewhere (revisit the open question in Section 10 on manager permissions with this in mind)
- **Cadence:** infrequent, manual entry — wages don't change often, product spend maybe monthly
- **Future upgrade path — QuickBooks integration (Phase 2+):** manual input is the correct MVP approach — it validates whether the profitability calculations are actually useful before investing in an accounting integration. Once proven valuable, QuickBooks (assuming that's the salon's accounting platform — confirm) has a standard API that can supply product/COGS costs and potentially payroll data automatically, replacing the manual entry screens with a synced feed. Design the `product_costs` and `stylist_wages` tables (Section 4.2) so a QuickBooks adapter can populate them later using the same adapter-pattern approach as Fresha/Meta/Google (Section 8.1) — the manual input UI and a future QuickBooks sync should both write to the same schema, so nothing about the insight engine needs to change when the upgrade happens, only the ingestion source.

### 3.6 Service Catalog Input (New) — Price, Duration & Cost Matching
A manually maintained catalog of every actual bookable service (matched to Fresha's own service names), giving the insight engine what it needs to assess profitability per service, not just per client or per stylist.

- **What gets entered per service:** service name (matched exactly to the `raw_service_name` values already coming through in Fresha exports, so it maps cleanly onto `service_categories`), current price, and standard duration (minutes) — mirroring what's already set up in Fresha, just re-entered here once so the AI has it structured
- **Optional but valuable if available:** an estimated product/consumable cost per service (e.g. "Full Highlights" uses roughly £X of colour product) — even a rough estimate is useful, doesn't need to be perfectly precise at MVP
- **Why this matters:** price and revenue alone don't reveal whether a service is actually profitable — a service that's fully booked but takes 3 hours and uses expensive product can be quietly less profitable per chair-hour than a quick, cheap service that looks smaller on paper. Duration is the missing variable that turns "revenue per service" into "profit per hour of chair time," which is the number that actually matters for pricing decisions
- **Cadence:** infrequent manual entry — update whenever the salon's price list changes, not a recurring task
- **Relationship to `service_categories`:** this is more granular than the broad colour/cut/chemical categorization already in the schema (Section 4.2) — that table groups services for prediction purposes (e.g. "is this a colour service"), this catalog is the actual per-service menu with real commercial numbers attached. Both reference the same `raw_service_name` so they stay linked.

### 3.7 Stock/Inventory Management (New)
Directly targets a real, stated operational pain point — last-minute "we're out of X" messages from staff. Two complementary mechanisms, not one big inventory system.

**Mechanism 1 — Centralized low-stock flagging (solves the immediate problem):**
- A simple, fast way for staff to flag "running low on X" the moment they notice it, replacing the current ad-hoc text-message pattern with one central, visible list the owner/manager can act on
- **Access method — resolved (Q18), configurable rather than a single fixed choice:** a shared tablet and a QR code are the same underlying artifact — a no-login, public quick-flag form URL — just accessed differently (a fixed device in the salon vs. scanned on a phone). Build that public form once; it serves both cases with no extra work. The third option, routing through the manager, needs no dedicated staff-facing UI at all, since the manager already has full access via the normal owner/manager screens. **Settings gets a simple toggle:** the public quick-flag form on/off. Off means staff go through the manager in the interim; on means the form (and its QR code, generated from the same URL) is live. Owner can flip this at any time as circumstances change — no rebuild needed either way.
- Each flag captures: product name, urgency (e.g. "still have some" vs "completely out"), who flagged it, when — visible immediately on the owner/manager's to-do list (Section 5.5), not buried
- **Product catalog:** a manually maintained list of key products (name, unit, reorder threshold, supplier/where it's bought, approximate cost) — doesn't need to cover every retail item exhaustively at MVP, focus on the operationally critical ones (colour/chemical supplies) that actually cause a service to be turned away if missing
- **Fully owner-editable, not a fixed seeded list (New):** a simple add/remove/edit screen in Settings, alongside the quick-flag toggle above. This is the better resolution to Q19 — rather than needing a complete, correct product list defined upfront before anything can be built, start with a small illustrative starter set and let the real catalog take shape through ordinary use as products get added or removed over time. Removing a product should be safe against any open flags/history referencing it (soft-delete or block-if-referenced, not a hard delete that orphans past flags).

**Mechanism 2 — Predictive consumption forecasting (the genuinely valuable AI layer):**
- Rather than relying purely on manual counts or reactive flags, estimate product consumption from actual booking volume — the service catalog (Section 3.6) already links each service to an estimated product cost; extending that to estimated product *quantity* consumed per service booking allows the system to project roughly when a product will run low based on real, upcoming booking volume, not guesswork
- This is what actually reduces the "last-minute" nature of the problem — flagging "at current booking pace, you'll likely need more bleach within 10 days" *before* anyone runs out, rather than only reacting once someone notices the bottle's empty
- **Realistic accuracy expectation:** this is an estimate, not a precise stock count — worth clearly labeling as a prediction with a confidence level (same pattern as elsewhere in Section 8), since actual usage varies appointment to appointment. Precision improves over time as real "ran out" events get logged and can calibrate the estimate.
- **Not in scope:** real-time exact stock deduction per appointment (would need integration with an actual retail/stock system Fresha doesn't provide) — the predictive-estimate approach gets most of the practical value without that complexity

---

## 4. Data Warehouse (Supabase / Postgres)

### 4.1 Core Principle
Supabase is the **single source of truth**, not a pass-through. Once data lands here, the system doesn't need Fresha, Meta, or Google to keep functioning for historical analysis — only for new data. This protects you if any platform restricts API access.

### 4.2 Core Entities (draft schema — refine before build)
- `clients` — deduped client record, canonical ID, links to Fresha client ID
- `appointments` — service, date, stylist, price, client_id, service_category
- `service_categories` — mapping raw Fresha service names → normalized categories (colour, cut, chemical treatment, etc.) — needed for the "colour client" prediction logic specifically
- `client_service_history` — derived/computed table: per client, per service category, average interval between visits, last visit date, predicted next-due date
- `ad_campaigns` / `ad_spend_daily` — per platform, per campaign, spend + performance metrics
- `insights_log` — every AI-generated recommendation, timestamp, category, status (pending/actioned/dismissed), outcome tracking (did it work?)
- `import_batches` — audit log of every manual Fresha upload: who, when, row counts, validation errors, so you can trace data issues back to source
- `industry_benchmarks` — curated reference data (Section 3.4)

### 4.3 Data Integrity Requirements
- Deduplication logic for clients (Fresha's own dedup is imperfect per their own docs)
- Soft-delete / versioning rather than overwrite on weekly upload, so you can always see what changed
- No destructive overwrites — every import is additive/reconciled, never a blind replace

---

## 5. AI Insight & Recommendation Engine

### 5.1 Core Logic (not pure LLM — hybrid)
- **Deterministic layer first:** actual statistics computed in SQL/code — average rebooking interval per client per service, lapse-risk scoring, spend-vs-booking correlation. This should NOT be left to the LLM to "calculate" — LLMs are unreliable at arithmetic and consistency. Compute the numbers with code, then pass the *results* to the LLM for narrative/insight generation and recommendation phrasing.
- **LLM layer second:** takes structured, pre-computed data + industry benchmark context, generates natural-language insight, prioritization, and recommended actions.

### 5.2 Required Insight Types (MVP)
1. **Colour top-up prediction** — per client, per colour category, predicted due date based on historical interval; flagged when within the next 7 days (weekly cadence)
2. **Lapse risk flagging** — clients trending toward churn based on their *own* historical pattern, not a generic threshold
3. **Marketing recommendation summaries** — e.g. "12 clients are predicted due for colour top-up this week, suggest email/SMS send" — structured output ready to hand to Mailchimp, not auto-sent at MVP
4. **Ad performance narrative** — plain-language weekly/daily summary of spend vs. bookings, flagged anomalies (not auto-adjusted — recommend only, per your own risk call)
5. **Stylist profitability analysis** — revenue vs. wage + product cost per stylist, over configurable time periods; surfaces who's under/over-performing relative to cost, and what booking volume would justify a raise or flag a problem
6. **Prioritized action list ("to-do")** — see 5.5
7. **Expansion signal tracking** — see 5.6
8. **Blended CAC tracking** — see 5.8
9. **AOV growth insights** — see 5.9
10. **SEO & local search insights** — see 5.10
11. **Service-level profitability & pricing insights** — see 5.11
12. **Staff recruitment & retention tracking** — see 5.12
13. **Business indicator framework (quant-style signals)** — see 5.13
14. **Stock/inventory insights** — see 5.14

### 5.8 Blended Customer Acquisition Cost (CAC)
- **Core metric:** total ad spend (Meta + Google combined) over a period, divided by total new clients acquired in that same period — a single blended figure, not platform-attributed. This mirrors the way experienced operators (e.g. Alex Hormozi's stated approach) actually track it in practice: total spend in, total new clients out, rather than trusting each platform's own attributed conversion count.
- **Why blended matters more than per-platform CAC here:** per-platform "cost per conversion" numbers reported by Meta and Google are known to overlap and over-claim credit for the same client (both platforms can claim the same booking), so summing platform-reported conversions double-counts. Blended CAC sidesteps this entirely by working from actual new-client counts in Fresha against total spend, regardless of which platform gets internal credit.
- **New client definition:** needs a precise, consistent rule (e.g. first-ever appointment recorded in Fresha within the period) — define this once and keep it consistent so the metric is comparable month to month.
- **Time period handling:** track on a rolling basis (e.g. trailing 30/90 days) as well as calendar month, since ad spend and client acquisition don't always land in the same period (a campaign at month-end may convert into the following month)
- **Display alongside AOV/LTV, not alone:** raw CAC in isolation isn't that useful — it matters relative to what a client is worth. Pair this with average ticket value and, ideally, an estimated client lifetime value (ties into the retention/rebooking data already tracked) so the AI can reason about whether current CAC is actually healthy, not just report a number
- **Insight framing:** the AI should flag when blended CAC is trending up or down significantly, and — combined with the profitability logic elsewhere — suggest whether that's a signal to increase, hold, or pull back spend (as a recommendation, not an automated action, per Section 5.3)
- **Owner to define:** a target CAC ceiling or a target ratio (e.g. CAC should not exceed X% of average client value) — flagged as an open question below (Section 13) until a specific benchmark figure is set

### 5.9 Average Order Value (AOV) Growth Insights
- **Core principle (from Section 3.4 benchmark notes):** small percentage gains in average ticket compound significantly over a year — this deserves its own dedicated insight category, not just a number buried in a general sales report
- **Required insight types:**
  - **Add-on/upsell gap detection** — flag clients or appointment types where a common add-on (e.g. toner, treatment, retail product) is frequently skipped compared to similar clients/services, surfacing it as a specific, actionable prompt for the stylist or front desk rather than a vague "upsell more" message
  - **Retail attachment rate tracking (Updated)** — retail conversion rate calculated as: number of retail transactions in a period (from the Fresha Retail Sales report, Section 3.1) ÷ number of distinct clients seen in that same period. Tracked both salon-wide and per-stylist (e.g. "5 of 50 clients this week bought retail — 10% conversion"), on a weekly rolling basis to match Fresha's natural reporting cadence. Flagged as trend-over-time so a declining or persistently low rate surfaces as an opportunity, not just a static number — e.g. "Stylist X's retail conversion has sat at 4% for the past month, well below the salon average of 12% — worth a conversation, not a criticism" (same non-judgmental framing principle as Section 5.12's retention-risk flagging)
  - **Why this matters (owner's own framing):** low retail attachment isn't a minor gap — it's presented as one of the more direct, low-effort revenue opportunities available, since the client relationship and trust already exist at the point of sale; the AI's job is to make the gap visible and specific rather than let it sit unnoticed in a report nobody checks
  - **This does not require appointment-level itemization to work:** unlike the add-on-gap detection above, the conversion-rate calculation only needs two counts per period (retail transactions, clients seen) — both available directly from separate Fresha reports, sidestepping the itemization uncertainty noted below
  - **Service-tier mix tracking** — proportion of bookings at standard vs. premium/deluxe service tiers, flagging if there's room to introduce or promote a higher tier for a specific service category
  - **Bundling opportunity flagging** — identify frequently co-occurring services that aren't currently offered/promoted as a package, based on actual booking pattern data
  - **AOV trend by stylist** — since AOV can vary significantly by stylist, track this individually (ties into Section 5.2 item 5, stylist profitability) so coaching/recommendations can be targeted rather than salon-wide
- **Output format:** these should feed directly into the high-leverage to-do list (5.5) as specific, actionable items — e.g. "Toner add-on rate for colour appointments dropped 15% this month — worth a quick reminder to the team" rather than a passive chart nobody acts on
- **Data dependency note:** service-level and product-attach detail depends on what Fresha's exports actually capture at the line-item level — confirm during the Fresha report review (Section 3.1) whether retail/add-on sales are itemized per appointment or only as separate transactions, since this affects whether attach-rate tracking is fully achievable from Fresha data alone at MVP

### 5.10 SEO & Local Search Insights
Real, prioritized recommendations from the free data sources in Section 3.3 — not just a metrics dump. Same principle as everywhere else in this section: deterministic analysis of the actual data first, LLM narrates and prioritizes second.

- **Local pack / GBP health checks:**
  - Flag incomplete or inconsistent business info (hours, categories, services listed) against what's actually offered — a common, easy-to-fix ranking factor
  - Review velocity and response-rate tracking — flag if review requests have gone quiet, or if recent reviews are unanswered (response rate is itself a ranking signal, not just a reputation nicety)
  - Track GBP performance metrics (views, calls, direction requests) over time and flag meaningful drops as anomalies, same pattern as the ad performance narrative in 5.2
- **Organic search health checks:**
  - Flag pages/queries with high impressions but low click-through rate — a strong signal the page ranks fine but the title/snippet isn't compelling, which is a concrete, fixable recommendation rather than vague "improve SEO"
  - Flag queries trending downward in position over time, especially for clearly commercial/local-intent terms (e.g. "hair salon [town]", "balayage near me")
  - Track whether the site is actually ranking for the treatment/service names in the salon's own service menu (ties the service_categories table from Section 4.2 directly into SEO tracking) — flags a real content gap if a well-booked service has no corresponding ranking page
- **Prioritization logic:** weigh recommendations by realistic effort vs. impact — e.g. "add missing service hours to GBP" is near-zero effort and should rank above a suggested content/blog strategy that takes real time, even if the latter has a theoretically bigger ceiling. This mirrors the same ranking principle already defined for the to-do list in 5.5.
- **Output format:** feeds directly into the high-leverage to-do list (5.5) as specific, actionable items — e.g. "12 recent reviews haven't been replied to — costs you local ranking signal" rather than a passive SEO score nobody acts on
- **Explicitly not in scope at MVP:** competitor keyword gap analysis, backlink profile analysis — these need the Phase 2 paid tool (Section 3.3) and are lower priority than the free, directly actionable local-search fixes above

### 5.11 Service-Level Profitability & Pricing Insights
Combines the service catalog from Section 3.6 (price, duration, estimated cost) with actual Fresha booking data and stylist cost data (Section 3.5) to assess whether each service is genuinely profitable, not just popular.

- **Core calculation — profit per chair-hour:** for each service, `(price − estimated product cost − allocated stylist time cost) ÷ (duration in hours)`. This is the number that actually matters for pricing decisions — a service with a high price tag but a long duration can be worse for the business than a cheaper, faster one, which isn't visible from revenue figures alone.
- **Allocated stylist time cost:** `hourly_rate × (service_duration_minutes / 60)` — straightforward now that the pay model is confirmed hourly (Section 13, Q8 resolved). Full formula: `profit_per_chair_hour = (price − estimated_product_cost − (hourly_rate × duration_hours)) / duration_hours`. Since rate varies by stylist, this can be calculated per-stylist-per-service where a service is offered by multiple stylists at different rates, or against a salon-average hourly rate for a simpler first pass at MVP — worth deciding which given the added complexity of per-stylist variants.
- **Required insight types:**
  - **Underpriced service flagging** — services where actual profit-per-chair-hour sits notably below the salon's other services, surfaced as a specific "consider raising the price of X by £Y" recommendation, not a vague warning
  - **Overlong service flagging** — services where the booked duration is consistently running longer than the catalog's standard duration (cross-referencing actual Fresha appointment timestamps against the catalog if that data's available), which either means the price needs adjusting or the standard duration itself is set wrong
  - **Portfolio mix insight** — flags if the salon's *most booked* services aren't necessarily its *most profitable* ones, which is a genuinely useful strategic insight (e.g. "your top 3 services by volume are actually your bottom 3 by profit-per-hour")
- **Output format:** feeds into the to-do list (Section 5.5) same as everything else — specific and actionable, e.g. "Full Highlights nets less profit per hour than 4 of your other 6 colour services — worth a £X price review"
- **Data dependency:** the accuracy of this whole feature depends entirely on how good the manually-entered cost estimates in Section 3.6 are — worth flagging low-confidence results (same pattern as Section 8's confidence flagging elsewhere) if cost data is rough/estimated rather than precise

### 5.5 High-Leverage To-Do List
- Every insight cycle (weekly at MVP), the system distills all recommendations into a single ranked to-do list — not a wall of separate reports the owner has to mentally prioritize themselves
- **Ranking is £-led, not just qualitative (Updated):** every item shows an estimated £ impact figure front and centre, not buried in the detail text — e.g. "£340/month" next to the headline, so priority is visually obvious at a glance rather than requiring the owner to read and judge each item themselves. Sort order is driven by this figure (blended with urgency where relevant, e.g. a time-sensitive item can outrank a slightly larger but non-urgent one).
- **Honest confidence framing on every £ figure:** these are estimates, not guarantees, computed from real warehouse data (deterministic calc, LLM narrates — same principle as Section 5.1) — worth a visible confidence indicator (Section 8) alongside the number so it never reads as more precise than it is, especially for newer/thinner-data items
- Each item should be actionable and specific, not vague ("email these 23 clients" not "consider improving retention")
- **Status workflow (Updated):** each item supports a simple status beyond just "done/dismissed" — open, in progress ("waiting," as you put it — started but not yet resolved), done. A free-text note can be attached at any point (e.g. why something's waiting, what was actually done) — this note is what feeds the rejection/outcome memory loop in 5.3 and 5.4.1, not just a UI convenience
- Completed/dismissed items logged (feeds the outcome-tracking loop in Section 5.3)
- **Feeds the chat consultant directly:** the to-do list itself — open items, £ impact, status, notes — is part of the rolling operational memory the chat (Section 5.4.1) draws on, so the owner can ask things like "what's still open from this week" or "why did I mark the retail one as waiting" and get a real answer, not just query the warehouse independently of what's already on the list
- This is arguably the single most important UI surface in the product — it's the answer to "what should I actually do this week," which is the whole point of the system

### 5.6 Growth Roadmap (formerly "Expansion Readiness Signal")
A dedicated, visual, AI-generated roadmap feature — not just a background metric, its own space in the app where the owner can see a clear path from where the salon is now toward a second location.

- **Roadmap structure:** a sequence of concrete milestones/stages (not just a single readiness score), each with the specific metrics that need to be hit before moving to the next stage — e.g. "Stage 1: Stabilize retention above target" → "Stage 2: Sustained profitability per stylist above threshold for 3+ months" → "Stage 3: Consistent capacity/waitlist pressure" → "Stage 4: Systemization complete (per Section 3.4 operations principle) — the salon can run without daily owner presence" → "Ready to evaluate second location"
- **Progress visualization:** each stage shows current status against its target (e.g. a progress bar or clear "on track / behind / achieved" state), generated from real warehouse data wherever possible, not just narrative text
- **AI-generated narrative layer:** alongside the visual progress, the LLM narration layer explains *why* a stage is or isn't complete in plain language, referencing the specific numbers driving that assessment (ties to the no-fabricated-numbers principle in Section 5.4)
- **Milestone thresholds need real numbers, not vague criteria** — this depends on the same open questions already flagged (Section 13) around target retention %, profitability thresholds, and utilization targets; the roadmap can launch with placeholder/estimated thresholds and refine them as real data accumulates
- **"Where" remains separate and out of scope** — the roadmap covers readiness (should we expand), not location selection (where should we expand), which needs external data sources per the original scoping decision
- **Update cadence:** monthly/quarterly recompute, matching the low-frequency nature of these metrics — this shouldn't refresh weekly like the operational to-do list
- **Standalone view, not buried in the main dashboard** — given the ambition behind this feature, it deserves its own dedicated screen/tab (ties to Section 7's navigation requirements) rather than being a small card on the main dashboard

### 5.3 Recommendation, Not Execution (MVP + likely permanent for ad spend)
- All AI outputs are **recommendations requiring human approval** — no write access to ad platforms or automated spend changes at MVP or Phase 2
- Every recommendation logged with accept/reject/edit outcome — this data itself becomes valuable over time (which recommendations were actually good?)
- **Explicit non-goal for now:** full autonomous ad budget control. Revisit only after months of evidence the recommendations are consistently right.

### 5.4 Conversational Dashboard ("Salon Consultant" chat)
- Natural-language query interface over the warehouse + benchmark data
- Must maintain context: salon profile (stylist roster, pricing, service menu, historical patterns) persisted and injected into every query, not re-explained each session
- Should be able to answer both operational questions ("which clients are due this week") and analytical ones ("which stylist has the best rebooking rate")
- Needs guardrails: no fabricated numbers — every factual claim must trace back to warehouse data, not LLM inference. (Design principle: LLM narrates real computed data, never invents figures.)

### 5.4.1 Persistent Memory Architecture (Bespoke Consultant)
This needs to be more than "an LLM with a system prompt" — the value is entirely in it acting like a consultant who's worked with your salon for years and never forgets anything. Break memory into distinct layers rather than one blob of context, or it degrades fast:

- **Static salon profile** — stylist roster, pricing, service menu, location, target margins. Rarely changes; injected into every conversation.
- **Rolling operational memory** — recent conversations, decisions made, recommendations accepted/rejected and why (if the owner gives a reason when dismissing a recommendation, that reason should be captured and influence future suggestions — this is the actual "it remembers everything" feeling). **Includes the to-do list itself (Section 5.5)** — current open items with their £ impact figures, in-progress/"waiting" items with notes, and recently completed items — so the chat and the to-do list feel like one connected system, not two separate features answering from different data.
- **Long-term structured memory** — not raw chat logs fed back in (this gets expensive and messy fast), but summarized/extracted facts: "owner prioritizes profitability over growth," "stylist X was flagged as underperforming in March, improved by June," "ad spend cut worked well in December 2025." Store these as structured records tied to dates/entities, not free text blobs, so they're queryable and don't silently vanish once a chat window's context fills up.
- **Retrieval, not full-history-in-prompt** — as history grows, don't dump the whole conversation log into every prompt (cost + accuracy both degrade). Pull relevant memory records based on the current question, similar to how the warehouse data is queried. This is the actual engineering challenge behind "remembers everything" and is worth designing properly rather than bolting on later.
- **Correction handling** — if the owner tells it it's wrong about something, that correction needs to persist and override future answers on that topic, not just apologize once and forget

---

### 5.7 Employee/Stylist Portal (Phase 2+, design access control now)
A separate, deliberately narrow login for stylists themselves — not a scaled-down version of the owner dashboard, a genuinely different, self-scoped view.

- **What a stylist should see about themselves:**
  - Their own booking volume / utilization trend
  - Progress toward a defined target (e.g. "£X more in monthly bookings to reach next pay tier") — requires the raise/target logic from Section 3.5 to actually be formalized into concrete thresholds, not just an owner-facing profitability number
  - Their own rebooking/retention rate, framed positively as a performance metric they can influence
- **What a stylist should never see:** other stylists' pay, other stylists' profitability comparisons, salon-wide financials, wage data belonging to anyone but themselves. This needs to be enforced at the data-access layer (Section 8.1, item 3), not just hidden in the UI — a UI-only restriction is not real security.
- **"Ask for help / request something" (future):** a lightweight request channel — e.g. requesting a schedule change, flagging they're overbooked, asking a product question — that routes to the owner/manager rather than being answered autonomously by the AI. Keep this as a routing/logging feature, not an AI-decides-things-about-staff feature; decisions about people should stay human.
- **Tone/framing matters here:** since pay/target visibility is inherently sensitive, this should read as motivating and transparent ("here's what you need to hit and how close you are"), not surveillance-flavoured. Worth deliberately designing the copy/UI with that in mind, not just bolting numbers onto a page.
- **Recommend Phase 2+, not MVP** — this depends on the wage/profitability model in Section 3.5 being fully defined and tested internally first (owner-only) before any employee-facing version is trustworthy enough to expose.

### 5.12 Staff Recruitment & Retention Management (New)
Staffing turnover is flagged as one of the biggest structural problems in the hair industry — worth treating as seriously as client retention in this system, not an afterthought. Real, honest scoping below on what's actually achievable.

**On Indeed specifically — direct integration isn't realistic:** Indeed's public job-posting API was shut down in 2023. What remains is entirely employer-side, designed for large ATS platforms integrating hundreds of employer accounts, requiring a lengthy partner approval process and weeks of technical review — completely disproportionate for a single salon's app. **Recommendation: don't build an Indeed API integration.** Instead, the app should simply generate a well-formatted job description (pulling from the same values/culture-fit principles already captured in Section 3.4's knowledge base) that the owner copy-pastes into Indeed's normal posting flow manually. This is a five-minute manual step, not worth the disproportionate engineering cost of chasing an API that isn't really available.

**What's genuinely worth building instead — an internal recruitment & retention tracker:**
- **Applicant tracking (lightweight):** a simple internal record per candidate — name, contact, stage (applied/interviewed/offered/hired/rejected), notes — even a basic version beats tracking candidates in someone's head or a messy spreadsheet
- **Time-to-hire and cost-to-hire tracking:** how long a vacancy sits open, and what it costs (ad spend if any, lost revenue from an empty chair) — genuinely useful data for future hiring decisions and links back to the profitability calculations already in Section 5.11
- **Turnover/retention risk flagging for existing staff:** using data already in the warehouse — declining booking volume for a specific stylist, declining rebooking rate for their clients, tenure length — as *early* signals worth a conversation, not a diagnosis. This should be framed very carefully: a flag for the owner to check in personally, never an automated or public-facing judgment about a staff member. Ties into the existing profitability/utilization tracking (Section 5.2 item 5) as an additional lens on the same data, not a new data source.
- **Onboarding checklist tracking:** a simple structured checklist per new hire (training milestones, review dates) — supports the "structured career progression" principle already captured in the knowledge base (Section 3.4) and ties naturally into the employee portal's progression view (Section 5.7) once that's built
- **Vacancy-to-fill impact estimate:** when a chair sits empty, estimate the revenue impact using the same profitability data already in the warehouse (average revenue per stylist per week) — turns "we need to hire" into a concrete, quantified urgency signal on the to-do list (Section 5.5) rather than a vague ongoing concern

**Explicitly out of scope:** any direct posting/sync to Indeed, LinkedIn, or other job boards via API — manual posting is the correct approach here, not a gap to fill later. Revisit only if a job board later offers genuine small-business self-serve API access.

### 5.13 Business Indicator Framework ("Quant-Style" Signals)
Right now, Section 5.2's insight types (CAC, AOV, profitability, SEO, staffing, etc.) each generate their own separate recommendations. This section formalizes them into one consistent **signal system** — every major business question gets a clear, glanceable state, the way a trading dashboard shows a clean read on a position rather than a paragraph of commentary. This is a structural/presentation layer on top of the existing deterministic calculations, not a new data source.

**Standard signal shape (every indicator uses this same structure):**
- `name` — what question this answers (e.g. "Should we hire another stylist?")
- `current_value` — the actual number(s) driving the read
- `status` — a simple three-state read: **strong / neutral / caution** (deliberately not red/amber/green — those imply stoplight urgency which is wrong for something like "consider hiring," a strategic decision, not an emergency)
- `trend` — improving / stable / declining, based on recent history, not just a single snapshot
- `confidence` — ties into the existing low/medium/high confidence pattern (Section 8) — an indicator built on 2 months of data should visibly say so, not present with false certainty
- `reasoning` — one or two lines of plain-language explanation of what's driving the current read, generated by the LLM narration layer from the real computed numbers (never fabricated, per Section 5.4's no-invented-numbers principle)

**Flagship example — the Hiring Signal, since this is the specific question raised:**
Combines several existing data points into one composite read on whether it's time to bring on another stylist:
- **Capacity/utilization** — are existing stylists consistently booked near full capacity over a sustained period (not just one busy week)?
- **Waitlist/turned-away pressure** — are clients regularly unable to book within a reasonable window? (Requires either a waitlist feature in Fresha being exported, or inferring it from booking lead-time patterns — flag as a data-availability question if Fresha doesn't expose this cleanly.)
- **Revenue trend vs. capacity ceiling** — is revenue growth flattening specifically because there's no more available chair time to sell, not because of weaker demand?
- **CAC efficiency being wasted** — is the salon paying to acquire new clients (Section 5.8) who then can't get booked in a reasonable timeframe, effectively wasting ad spend on demand the salon can't currently serve? This is a genuinely sharp signal — spending on client acquisition while turning people away is a clear, quantifiable case for hiring.
- **Composite output:** a single "Hiring Signal" card showing current status (e.g. "Strong case to hire — capacity has been at 95%+ for 6 weeks, and CAC spend is acquiring clients your current team can't book within 2 weeks") rather than the owner having to mentally cross-reference four separate reports themselves

**Other indicators this framework should eventually cover** (build incrementally, don't try to do all at once):
- Pricing signal (tied to Section 5.11 — is now a reasonable time to review prices given profitability trends)
- Marketing spend signal (tied to Section 5.8 — increase, hold, or reduce ad spend)
- Retention health signal (tied to Section 5.2 items 1–2 — is churn trending better or worse than usual)
- Expansion readiness — this is really the Growth Roadmap (Section 5.6) expressed as a longer-horizon version of the same signal pattern

**UI placement:** a dedicated indicator panel, likely on the Home tab (Section 7.3) as a compact row of signal cards, each drilling into full reasoning/history on tap — this is the "quant dashboard" feel the owner's after, a fast, confident read across the whole business rather than reports to interpret.

**Important honesty constraint:** these are decision-support signals, not automated triggers — same recommend-only principle as everywhere else in Section 5.3. A "strong" hiring signal is a prompt for the owner to seriously consider it, not a system making a hiring decision. Worth stating this explicitly in the UI copy too, not just the backend logic, so it never reads as more authoritative than it actually is.

### 5.14 Stock/Inventory Insights
Real insight logic built on the two mechanisms in Section 3.7 — same deterministic-first, LLM-narrates-second pattern as everything else in this section.

- **Low-stock to-do items:** every open flag from Mechanism 1 (Section 3.7) becomes a to-do list entry (Section 5.5), prioritized by urgency ("completely out" outranks "getting low") and by how commercially critical the product is (e.g. a core colour product blocking bookings outranks a retail item)
- **Predictive reorder recommendations:** from Mechanism 2's consumption forecasting — "at current booking pace, [product] will likely need reordering within [X] days" — surfaced with enough lead time to actually act on it, not as a last-minute alert
- **Stockout impact estimate:** where possible, connect a predicted stockout to actual booking risk — e.g. "12 colour appointments booked in the next 2 weeks may be affected if [product] isn't reordered," using the service catalog (Section 3.6) to know which bookings depend on which products. This turns a vague inventory warning into a concrete, quantified business risk, consistent with how other sections (5.12's vacancy impact, 5.13's signals) already turn raw data into business-relevant numbers.
- **Output format:** same principle throughout this document — specific and actionable, not a passive stock level report nobody checks

---

## 6. Marketing Integration

- Output format compatible with Mailchimp (owner already has this connected) — MVP likely exports a segmented client list (CSV or direct API push) that Mailchimp campaigns target
- Phase 2: direct Mailchimp API integration so flagged clients auto-populate a segment/audience without manual export
- SMS: confirm current provider (Fresha built-in? Separate tool?) and whether integration is same pattern as Mailchimp

---

## 7. UI/UX Requirements

### 7.1 Brand & Visual Identity
- Salon brand: **MedLocks**. Logo uses a warm charcoal/dark grey (primary wordmark) paired with a soft blush pink (accent wordmark), on a cream/off-white background — a soft, warm palette rather than a cold corporate one.
- **Approximate palette to build the design system from** (refine exact hex values against the logo file directly, these are close reads):
  - Charcoal/ink: `#4A4A47` — primary text, primary UI elements
  - Blush pink: `#E8A0B8` — accent color, primary CTA highlights, active states, key metric highlights
  - Cream/off-white: `#EDE8DE` — background, not stark white — keeps the warm, soft feel from the brand
  - Supporting neutrals (greys derived from the charcoal at varying opacity) for secondary text, borders, disabled states
- **Vibrancy note:** the owner wants this to feel vibrant and "next level," not muted — use the blush pink more confidently than a typical restrained corporate accent color (data viz highlights, active nav states, key numbers) while keeping the charcoal/cream as the calm base, so the pink actually pops rather than being a token accent
- Typography should feel a step more premium/considered than a default template — the brand itself uses a confident script/display font for the wordmark, so the app's UI typography (which will be a clean sans-serif for actual usability) should still feel intentional and high-quality by comparison, not generic
- This is a real design system, not a one-off skin — define it as reusable design tokens (colors, spacing, type scale) so it's consistent everywhere, not hand-set per screen

### 7.2 Navigation & Information Architecture
Given the growing scope of this product, a single dashboard page is no longer sufficient — this needs proper multi-tab navigation so each major function has room to be explored in depth rather than being compressed into a small card on one crowded page.

**Primary navigation (tabs/sections):**
1. **Home/Overview** — the condensed at-a-glance view (to-do list, headline metrics, alerts) — see 7.3
2. **Clients** — client-level detail: lapse risk list, colour top-up predictions, retention trends, drill into any individual client's history
3. **Marketing & Ads** — blended CAC, AOV insights, ad performance narrative, campaign-level detail, Mailchimp export tools
4. **Team** — stylist profitability, utilization, wage/target tracking (owner-only sections clearly separated from anything a future stylist login would see)
5. **Growth Roadmap** — the dedicated roadmap view described in Section 5.6, its own full space, not a widget
6. **Chat** — the persistent consultant chat (Section 5.4), accessible from anywhere but with its own full-screen dedicated view too
7. **Settings** — data source connections, thresholds/targets, GDPR tools (export/delete data), user management

Each tab should go deeper than the overview page — e.g. the Marketing & Ads tab shows full historical CAC/AOV trends, per-campaign breakdowns, and detailed insight explanations, not just the single headline number that appears on Home.

### 7.3 Home/Overview Priorities (within the Home tab specifically)
1. This week's high-leverage to-do list (Section 5.5) — front and center, not buried
2. Headline health indicators — revenue trend, bookings trend, stylist utilization, blended CAC, AOV, ad spend efficiency — each as a simple visual (trend arrow/sparkline, not a dense table), each linking through to its full tab for detail
3. Any active alerts (data sync issues, pending approvals, anomalies)

### 7.4 General Principles
- **Drill-down, not dump:** summary views link into detail views (e.g. tap "12 clients due" to see the actual list) rather than showing everything at once
- **Chat as a secondary, not primary, interface for quick checks** — the Home tab should answer "what's happening" without needing to ask; chat is for follow-up questions and exploration ("why is retention down this month"), though it also has its own full tab per 7.2
- **Mobile-first given PWA target** — owner/manager will likely check this on their phone between clients, not just at a desk; tab navigation needs a clean mobile pattern (e.g. bottom nav bar) not just a desktop sidebar squeezed down
- **No jargon dumping** — recommendations and insights written in plain operational language, not raw statistical output (ties back to the LLM-narrates-computed-data principle in Section 5.1)
- **"Next level" as a design bar, not just a functionality bar** — the ambition stated for this product is for it to feel like a premium, best-in-class tool, not a serviceable internal app; every screen should be held to that standard, referencing the brand palette in 7.1 throughout rather than defaulting to generic component-library styling

## 8. Application Structure (PWA / TS / React / Supabase)

### 8.1 Modules (aim: each independently testable, replaceable, minimal cross-dependency)
1. **Auth module** — Supabase Auth, role-based access (owner/manager/admin)
2. **Data ingestion module**
   - Fresha upload sub-module (file parsing, validation, staging, commit)
   - Ads sync sub-module (per-platform adapter pattern — Meta adapter, Google adapter, each conforming to a shared interface so adding a platform later doesn't touch core logic)
3. **Data warehouse access layer** — typed query layer (avoid raw SQL scattered through the app; a single data-access module other modules call into)
4. **Insight engine module**
   - Deterministic calculation sub-module (pure functions, easily unit-tested — this is the trust-critical part)
   - LLM orchestration sub-module (prompt construction, OpenAI API calls, response parsing/validation)
5. **Recommendation management module** — CRUD on recommendations, approval workflow, outcome logging
6. **Dashboard/reporting UI module** — charts, tables, summary views
7. **Chat UI module** — conversational interface, calls insight engine + warehouse layer
8. **Notification module** — alerts for data sync failures, token expiry, pending recommendations (in-app at minimum; email/push later)
9. **Settings/admin module** — API key management, cadence config, threshold config (e.g. "flag as due within X days")

### 8.2 Non-Functional / Architecture Requirements
- **Modularity:** each module above should be a separate folder/package with a clear, typed interface — no direct cross-module DB calls; go through the data-access layer
- **PWA requirements:** installable, works reasonably offline for viewing cached dashboard data (not for live actions), responsive for owner/manager checking on mobile
- **TypeScript strictness:** shared types for warehouse schema generated from Supabase (avoid hand-duplicated types drifting from actual DB schema)
- **Adapter pattern for external APIs:** every external data source (Fresha, Meta, Google, future SEO tool) implements a common interface so swapping the Fresha manual-upload adapter for the live-API adapter later is a contained change, not a rewrite
- **Monitoring/observability:** sync failures, stale data, and token expiry must surface as visible alerts, not fail silently (identified earlier as the biggest long-term risk)
- **Audit logging:** every data import and every AI recommendation logged with timestamp and outcome, for trust-building and future model evaluation

---

## 9. Data Integrity & Trust Requirements

- Deterministic calculations must be unit-tested and verifiable independently of the LLM
- Every AI-generated insight must be traceable back to the source data used to generate it (no black-box numbers)
- Small dataset caveat: insight engine should flag low-confidence predictions when a client has limited history (e.g. fewer than 2-3 prior visits) rather than presenting a guess as fact
- Ad platform metrics should be clearly labeled as "platform-reported" vs. "Fresha-confirmed booking" where relevant, given known attribution inflation — don't let the AI conflate the two

---

## 10. GDPR & Data Protection Compliance

This system processes personal data on UK/EU clients and employees (wage data), so GDPR (as retained in UK law post-Brexit, i.e. UK GDPR + Data Protection Act 2018) applies directly and needs to be designed in from the start, not retrofitted. This section should be treated as binding constraints on the technical build, not a separate legal afterthought.

### 10.1 Lawful Basis for Processing
- **Client operational data (appointments, service history, contact details):** lawful basis is likely "legitimate interests" (running the salon, service delivery) or "contract" (fulfilling a booked service) — this should be confirmed and documented, not assumed
- **Marketing communications (email/SMS nudges generated by the insight engine):** requires its own separate lawful basis, typically **consent**, under UK PECR (Privacy and Electronic Communications Regulations) as well as GDPR — soft opt-in may apply if clients gave contact details in the context of a sale and were given a clear opt-out, but this needs verifying against your actual client intake process, not assumed to be automatically fine because the data already exists in Fresha
- **Employee wage/performance data (Section 3.5, 5.7):** lawful basis is typically "contract" or "legitimate interests" for employment management, but wage data specifically warrants extra care — document this separately from client data processing
- **Action item:** produce a simple internal record of processing activities (a "ROPA") mapping each data category to its lawful basis, purpose, and retention period — this is a legal requirement (Article 30) once you're processing personal data systematically like this, not optional paperwork

### 10.2 Data Minimization & Purpose Limitation
- Only ingest fields actually needed for the defined insight types (Section 5.2) — don't pull every available Fresha field "in case it's useful later." Each field brought into the warehouse should map to a specific, documented use
- The AI/LLM layer (Section 5.1) should only be sent the minimum data needed to generate a given insight — avoid passing full client records to the OpenAI API when only aggregated/derived figures are needed for the narrative layer
- Review whether client names/contact details need to reach the LLM at all, or whether insights can be generated on pseudonymised/ID-referenced data with names re-attached only in your own UI afterward — this significantly reduces exposure if it's workable

### 10.3 Third-Party Processors & Data Sharing
- Every external service touching personal data (Fresha, Meta, Google, OpenAI/Anthropic API, Mailchimp, Supabase, any SEO tool) is a **data processor** under GDPR, and you need a Data Processing Agreement (DPA) in place with each — most major providers (OpenAI, Anthropic, Supabase, Meta, Google, Mailchimp) offer standard DPAs, but this needs to be actively checked and accepted per provider, not assumed to exist by default
- **International transfers:** confirm where each processor stores/processes data (US-based services need appropriate safeguards like Standard Contractual Clauses under UK GDPR) — worth checking Supabase project region settings specifically, and whether OpenAI's/Anthropic's API data handling terms meet UK GDPR transfer requirements
- Sending client data to an LLM API is itself a transfer to a processor — confirm the specific API terms around data retention/training use (e.g. zero-data-retention options where available) before sending real client data through, not just synthetic/test data

### 10.4 Individual Rights
The system needs to practically support these, not just acknowledge them exist:
- **Right of access** — a client or employee requesting "what data do you hold on me" needs to be answerable from the warehouse in a reasonable timeframe; consider whether an admin query/export tool for this is needed at MVP or Phase 2
- **Right to erasure** — deletion requests need to actually cascade through the warehouse (client record, appointment history, any AI-generated insights referencing them, any memory records in the chat system per Section 5.4.1) — this is a real technical requirement, not just a checkbox, and should be designed into the schema now (e.g. every table needs a clear path to delete-by-client-id)
- **Right to object to profiling** — this system is, by definition, profiling clients (predicting behavior, scoring lapse-risk) to make marketing decisions; clients should be able to opt out of being included in this kind of automated analysis specifically, separate from opting out of marketing emails generally
- **Right to rectification** — a mechanism for correcting inaccurate data (e.g. wrong contact details or a mismatched client record from deduplication errors) feeding back to the source of truth

### 10.5 Automated Decision-Making (Article 22 Consideration)
- Because the earlier design decision was **recommend-only, human-approves** (Section 5.3) rather than fully autonomous action, this substantially reduces Article 22 exposure, which specifically concerns decisions made *without meaningful human involvement*. Keep this human-in-the-loop principle as a compliance requirement, not just a risk-mitigation choice — it matters legally, not just operationally
- If ad spend automation or auto-sent campaigns are ever revisited (Section 12 flagged this as something to earn trust into over time), that decision needs re-assessing against Article 22 at that point, since removing the human approval step changes the compliance picture

### 10.6 Data Retention
- Define concrete retention periods per data category now, rather than storing everything indefinitely by default — e.g. how long is appointment history kept after a client stops visiting, how long are AI-generated insights/recommendations retained, how long is chat memory (Section 5.4.1) kept before being purged or summarized
- Build retention/deletion as a scheduled process from the start (even a simple periodic job), not a manual afterthought

### 10.7 Special Category Data Considerations
- Confirm whether any consultation-adjacent data ever discussed (allergies, medical/skin conditions relevant to chemical services) will touch this system at any point — health-related data is a **special category** under GDPR requiring a stricter lawful basis and extra safeguards. Given the consultation app is currently parked (Section 1), this is low risk today, but flag it clearly if that scope is ever revisited
- Wage data (Section 3.5) isn't special category, but is commercially sensitive and warrants the access restrictions already specified in Section 5.7 (owner-only visibility, enforced at the data layer)

### 10.8 Security Requirements (supporting GDPR's "appropriate technical measures")
- Encryption at rest and in transit for the Supabase database (Supabase provides this by default, but confirm configuration rather than assuming)
- Role-based access control enforced at the database layer (Supabase Row Level Security), not just in application code — ties directly to the access-control requirement already specified in Section 5.7 and Section 8.1
- API keys and credentials for Fresha/Meta/Google/OpenAI stored securely (environment variables/secrets manager), never committed to code or exposed client-side
- A basic breach response plan — even a simple documented process for what happens if data is exposed, since UK GDPR requires notifying the ICO within 72 hours of becoming aware of a qualifying breach

### 10.9 Practical Next Steps
- This section is a strong starting framework, not a substitute for actual legal advice — recommend a brief consultation with a solicitor or GDPR consultant familiar with UK SME requirements before going live with real client data, particularly to confirm the lawful basis conclusions in 10.1 and the marketing consent position in relation to your existing client base
- Update your salon's public-facing privacy notice/policy to reflect this new processing activity before launch — clients should be informed their data feeds this kind of analysis, even in a recommend-only, back-end capacity

---

## 11. MVP Scope (Phase 1) — Suggested Cut Line

**Include:**
- Fresha manual weekly upload (multi-report) + validation
- Client/appointment warehouse with dedup
- Deterministic colour top-up + lapse-risk calculations
- Manual wage + product cost input, basic stylist profitability calculation
- Basic LLM-generated weekly summary and ranked to-do list (Section 5.5)
- Blended CAC tracking (Section 5.8) and core AOV insight types (Section 5.9) — both are high-value, low-complexity additions to the existing ad sync and Fresha data, no new data sources required
- SEO & local search insights (Section 5.10) using Search Console + GBP APIs — both free, worth including at MVP given the low cost of access (start GBP API approval early per Section 3.3)
- Service catalog input (Section 3.6) and service-level profitability/pricing insights (Section 5.11) — Q8 now resolved (hourly pay model), so this is unblocked for MVP
- Basic internal applicant tracker and vacancy-impact tracking (Section 5.12) — lightweight, no external API dependency, so low-cost to include at MVP
- Hiring Signal specifically (Section 5.13's flagship indicator) — the other signals in 5.13 can roll out incrementally post-MVP, but this one directly answers a question you've asked for and is buildable from data already in scope
- Stock/inventory flagging (Mechanism 1, Section 3.7) — the low-stock flag-and-prioritize flow directly solves a real, stated operational problem and is low-complexity to build
- Predictive consumption forecasting (Mechanism 2, Section 3.7/5.14) — genuinely higher-value than manual flagging alone, worth including if it doesn't meaningfully slow MVP delivery; otherwise Mechanism 1 alone still solves the immediate pain point and Mechanism 2 can follow shortly after
- Meta + Google live ad sync, basic spend/performance dashboard
- Manual export of flagged client segments for Mailchimp
- Clean home dashboard per Section 7 (to-do list + headline metrics)
- Owner-only access (defer manager role/permissions complexity)
- GDPR baseline: documented lawful basis (10.1), deletion-by-client-id capability across all tables (10.4), retention periods defined (10.6), RLS-enforced access control (10.8) — these are treated as MVP-blocking, not deferred, since retrofitting deletion/consent logic onto a live system with real client data is far harder than building it in from the start

**Explicitly defer to Phase 2+:**
- Live Fresha API connector
- Direct Mailchimp API push
- Paid SEO tool integration (SEMrush/Ahrefs) for competitor/backlink analysis — Search Console + GBP are now MVP (Section 3.3, 5.10)
- Full industry benchmark knowledge base (Salon Jedi / Hormozi-derived frameworks) — MVP may include a small, hand-picked starter set rather than nothing, if low-effort
- Manager role & permission tiers
- Any ad spend automation/write-access
- Expansion "where" analysis (location/demographic data) — expansion "readiness" scoring can stay in MVP using only internal metrics; "where" needs new external data sources and is a distinct later project
- Employee/stylist portal (Section 5.7) — depends on wage/profitability model being proven internally first
- QuickBooks integration for product cost/wage data (Section 3.5) — manual input proves the value first; automate once justified
- Consultation app integration (parked indefinitely per earlier discussion)
- Any direct job board API integration (Indeed, LinkedIn, etc.) — permanently out of scope, not deferred; manual posting is the correct long-term approach (Section 5.12)

---

## 12. What Actually Makes This "Unfair" — Additional Moat Considerations

Being straight with you: most individual features here are replicable by a competitor with enough time and money. The real moat is a small number of specific things. Worth being deliberate about these rather than just adding more features.

**Genuinely hard to copy:**
- **Accumulated proprietary history.** A competitor starting today has zero years of client-level colour interval data, zero logged recommendation outcomes, zero corrections taught to the memory system. This gap only widens with time, and it's the one thing no amount of money buys quickly. Every month you run this and log outcomes, the gap grows — which means outcome-logging (already in Section 5.3) is actually more strategically important than any single feature.
- **The recommendation feedback loop compounding.** If you consistently log why you accepted/rejected suggestions (5.4.1), the system's suggestions should get measurably better over time in ways specific to *your* salon, not generic AI improvement. That's a moat competitors can't shortcut by buying the same tools.
- **Client-level prediction accuracy improving with more data points per client.** Year two's predictions will be meaningfully better than year one's simply because there's more history per client — this compounds without you having to build anything new.

**Worth adding, moderate effort, real value:**
- **Confidence/track record display.** Show the owner not just "here's a recommendation" but "recommendations like this have been right 80% of the time" — builds trust in the system and is itself only possible once you've got outcome history (ties to 5.3/12 above). This is also what eventually justifies trusting it with more autonomy.
- **Scenario simulation ("what if").** Let the owner ask "what if I raised colour prices 10%" or "what if I hired a 5th stylist" and get a data-grounded projection based on actual historical patterns, not a generic guess. This is a strong differentiator because it needs your real data to be any good — a generic tool can't do this well, only one sitting on your specific history can.
- **Anomaly alerts, not just scheduled reports.** Beyond the weekly cycle, flag anything unusual as it's detected (a stylist's rebooking rate suddenly dropping, ad cost-per-booking spiking) rather than waiting for the next report cycle to surface it.
- **Qualitative note capture.** A simple way for the owner/manager to log short observations ("stylist X seemed off this week," "had 3 complaints about wait times") that the AI can factor into its reasoning alongside the hard numbers — this is cheap to build and adds a dimension pure transaction data can't capture.

**Worth being cautious about:**
- Don't chase "more integrations" as a moat strategy — any competitor can also plug into Meta/Google/Mailchimp. Integrations are table stakes, not the advantage. The advantage is entirely in what you do with your own accumulated data once it's flowing through them.
- Resist the temptation to add autonomous execution (auto-adjusting spend, auto-sending campaigns) purely for "wow factor" before the recommendation engine has a proven track record — reference Section 5.3 and the earlier stress-test discussion. Trust is earned by logged accuracy over time, not by giving it more control early.

---

## 13. Open Questions to Resolve Before Build

1. Manager permissions: full parity with owner, or view/suggest only?
2. SMS provider — is this Fresha-native or separate, and does it need its own integration?
3. What counts as "due for top-up" precisely — fixed interval per client average, or a smarter model (e.g. weighted recent visits more than old ones)? Define the actual formula before coding it.
4. Confidence threshold for flagging a client as lapse-risk or top-up-due — needs an actual defined number, not "the AI decides"
5. Where does industry benchmark data actually come from, and how do you verify it's accurate for UK hairdressing specifically vs. generic/US salon data?
6. Has the Google Business Profile API access request been submitted yet? Given the days-to-weeks approval lag (Section 3.3), this should be applied for as early as possible, ideally now, so it's not blocking the SEO module later
7. Recommendation approval workflow — does rejecting a recommendation feed back into the system to improve future ones, or is it just logged?
8. ~~What's the actual stylist pay model?~~ **Resolved: hourly.** Stylists are paid an hourly rate, not commission or fixed salary. This simplifies the time-cost allocation formula in Section 5.11 to a straight `hourly_rate × (service_duration_minutes / 60)` — no commission-percentage layer needed.
9. What counts as an "expansion readiness" threshold in concrete numbers (e.g. what utilization %, what sustained profitability trend)? Needs real target figures once you have baseline data to calibrate against
10. How much of the industry benchmark content (Section 3.4) are you comfortable curating/writing yourself at MVP vs. treating as a later phase — this is manual, time-consuming work on top of the build itself
11. What are the actual pay-tier thresholds for stylist progression (Section 5.7)? This needs real numbers before an employee-facing progress view can be built — likely follows from resolving Q8 (pay model) first
12. Has a solicitor/GDPR consultant confirmed the lawful basis conclusions in Section 10.1, particularly for marketing use of existing client contact details under PECR soft opt-in rules?
13. Which processors (OpenAI/Anthropic, Supabase, Meta, Google, Mailchimp) currently have signed DPAs in place, and has Supabase's project region been confirmed for data residency purposes (Section 10.3)?
14. What's the target CAC ceiling or CAC-to-average-client-value ratio (Section 5.8)? Owner is researching an appropriate benchmark % for a salon business — needs a concrete figure before the AI can flag CAC as "healthy" vs "too high" rather than just reporting the number
15. ~~Does Fresha's export data itemize retail/add-on product sales per appointment~~ — **Resolved:** Fresha doesn't have a separate "Retail Sales" report as originally assumed — retail data comes from the Sales Summary report's Type dimension (Service vs. Product), confirmed in Section 3.1. **The retail conversion denominator gap is also now resolved** — the appointment list export gives per-appointment `Client` + `Scheduled date` + `Status`, so "distinct clients seen in period X, filtered to Completed" is directly computable. Salon-wide retail conversion can now be wired against real data. Per-stylist retail conversion remains blocked on the separate Team Member × Type crossing gap noted in Section 3.1.
16. Confirm the salon's accounting platform is actually QuickBooks (Section 3.5) before building the Phase 2 integration — worth double-checking rather than assuming
17. Does Fresha expose any waitlist or "fully booked" data that could feed the Hiring Signal's waitlist-pressure component (Section 5.13)? If not, worth checking whether average booking lead-time (how far in advance clients have to book) is a workable proxy instead
18. ~~How should staff access the low-stock flagging feature~~ — **Resolved (Section 3.7): configurable, not fixed.** A single no-login public quick-flag form serves both the "shared tablet" and "QR code" access patterns, toggled on/off in Settings. Off routes staff through the manager in the interim.
19. ~~Which products are actually worth tracking at MVP~~ — **Resolved (Section 3.7): doesn't need answering upfront.** The product catalog is fully owner-editable (add/remove/edit in Settings), so a small illustrative starter set is enough — the real list takes shape through ordinary use rather than needing to be correct on day one.

---

*This document is the working spec for the MVP build. Recommend treating Section 13 (Open Questions) as blocking — resolve before writing schema/code, since several answers change the data model. Section 10 (GDPR) items 10.1, 10.3, and 10.9 should also be treated as blocking before real client data touches the system.*