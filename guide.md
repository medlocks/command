# MedLocks Salon AI — Data & Operations Guide

What actually needs to go into the app, how often, and what's still missing. This reflects the real, live state of the build as of this write-up — not the original plan, the actual thing that exists right now.

---

## 1. Recurring uploads (Fresha CSV exports, via Data Import)

These need re-uploading on some regular cadence — weekly is the assumed rhythm throughout this build — for the app to stay current.

| Export | What it's for | Notes |
|---|---|---|
| **Client list** | New client detection, contact info | Clients with no email/phone get flagged, not imported — expected, not a bug |
| **Appointment list** | Colour top-up, lapse risk, AOV, CAC denominator, stylist profitability | The single most important export — most of the app's real insight logic depends on it |
| **Sales Summary — by Team Member** | Stylist-level sales | Currently has no real consumer yet — imported but not yet used anywhere |
| **Sales Summary — by Type** | Retail conversion numerator | Needed for real retail conversion; salon-wide only right now |

**Known gap:** per-stylist retail conversion needs a report crossing Team Member × Type — hasn't been found in Fresha's report builder yet. Worth checking again periodically; not blocking anything else.

**Known limitation:** client-to-appointment matching is by exact name text — a walk-in booked under a different name, or a name typed slightly differently, won't match. The app now surfaces an "unmatched appointments" count so this is visible rather than silent, and per-client dismissal (with auto-clear on the next real matched visit) handles the false-positive case on lapse-risk/colour-top-up lists specifically.

---

## 2. One-time / occasional manual entry (Settings → Manual Data)

Set these up once, update only when they actually change in real life.

- **Stylist roster** — name (add via Team page directly)
- **Stylist wages** — hourly rate per stylist. **Known gap:** no "close out the old rate" logic yet if someone's pay changes — worth flagging to Claude Code before the first real raise happens, so old and new rates don't both count as "current."
- **Service catalog** — real service names, prices, durations
- **Product costs** — most recent period's costs

## 3. Stock / inventory (`/stock`)

Built and working, but **still session-only** — resets on every page reload, never wired to the real database. Useful for testing the flagging/forecasting concept, not yet reliable for real day-to-day use. This is a known, flagged gap, not an oversight — worth a dedicated round when you're ready for it.

## 4. Ad platform credentials

| Platform | Status |
|---|---|
| **Meta Ads** | Live, real sync working (Settings) |
| **Google Ads** | Paused — blocked on Developer Token approval, which requires a Manager (MCC) account. Manual ad-spend entry works as a stopgap in the meantime (Settings) |
| **OpenAI** | Live, powers Chat |

## 5. Chat / AI consultant

Fully real and grounded in live data (roster, service catalog, product costs, CAC/AOV/colour-top-up/lapse-risk/stylist profitability), with two deliberate privacy limits: **individual stylist wages and real client names are never sent to it** — only aggregates. It will say "I don't have that" rather than guess, by design — worth spot-checking this occasionally, not just trusting it stays that way forever.

**Not yet built:** long-term memory across separate conversations (it doesn't remember last week's chat today) — was deliberately deferred once Chat proved useful without it.

## 6. Industry benchmarks — investigated, not yet built

A real feature to encode your own operating knowledge (what "good" looks like for retention, margin, retail conversion, etc.) so both Chat and the actual calculations can compare against real targets instead of hardcoded guesses. Investigated in detail but paused before building — pick this back up when ready.

## 7. Outstanding, not app-related

- **GDPR solicitor sign-off** — still open, and the most important non-technical item on this whole list. Real client PII has been live for a while now; this shouldn't keep sliding indefinitely.
- **Meta conversion event check** — go into Meta Ads Manager and confirm which real event should count as "a booking," so ad-performance conversion tracking can be wired for real instead of staying deferred.

## 8. A reasonable weekly rhythm, given all of the above

1. Export and upload the 4 Fresha reports
2. Check Home's to-do list, work through it, mark items done/waiting with notes
3. Glance at Marketing, Clients, Team for anything that jumps out
4. Ask Chat anything you're unsure about — it's grounded in the real numbers above
5. Add/update stylists, services, wages, product costs only as they actually change

---

*This reflects the app's real state at time of writing — update this doc whenever a "known gap" above gets closed, so it doesn't quietly go stale the way other things in this build occasionally have.*