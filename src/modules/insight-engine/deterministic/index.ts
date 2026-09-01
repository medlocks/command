export * from './visitInterval';
export * from './colourTopUp';
export * from './lapseRisk';
export * from './serviceHistory';
export * from './colourTopUpDue';
export * from './lapseRiskFlags';
export * from './stylistProfitability';
export * from './adPerformance';
export * from './headlineMetrics';
export * from './todoList';
export * from './blendedCac';
export * from './aov';
export * from './growthRoadmap';
export * from './seoCtrGaps';
export * from './seoReviews';
export * from './seoServiceGaps';
export * from './serviceProfitability';
export * from './staffRecruitment';
export * from './hiringSignal';
export * from './stockInsights';
export * from './stockForecast';
export * from './retailConversion';

// TODO(Section 5.10 — SEO & Local Search Insights): three pieces of the
// spec are deliberately NOT implemented yet, deferred by explicit scope
// decision rather than forgotten:
//   1. GBP info-completeness checks — flag incomplete/inconsistent business
//      info (hours, categories, listed services) against what's actually
//      offered. `GbpProfileSnapshotRecord` (data-ingestion/seo/googleBusinessProfile)
//      already models the shape this would read from; no calculation exists yet.
//   2. GBP performance-metric anomaly detection — views/calls/direction-requests
//      trending down, same pattern as `adPerformance.ts`'s anomaly detector.
//      `GbpPerformanceRecord` already models the shape.
//   3. Declining-position query tracking — queries trending downward in
//      position over time, especially commercial/local-intent terms. Not
//      the same thing as the CTR gap detector in `seoCtrGaps.ts`, which
//      only looks at CTR-vs-position, not position-over-time trend.
// None of these are urgent pre-launch — they only become buildable once
// real Search Console / GBP API access is actually connected (Section 3.3's
// own approval-lag warning) and there's real data to validate the logic
// against. Pick these up as a follow-on to this file, not a rewrite of it.

// TODO(Section 5.11 — Service-Level Profitability): "Overlong service
// flagging" (booked duration consistently running longer than the
// catalog's standard duration) is NOT implemented. It needs actual
// per-appointment duration data to compare against the catalog's
// `duration_minutes`, and `appointments` has no start/end time or duration
// column at all (only `appointment_date`) — the spec itself hedges this
// with "if that data's available." Revisit only if a future schema change
// adds real appointment duration capture.
