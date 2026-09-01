# Salon AI Command Centre — Setup Guide

This covers getting every external service connected: Supabase, Fresha (manual upload), Meta Ads, Google Ads, OpenAI, and Mailchimp. Do these roughly in order — later steps depend on earlier ones.

---

## 1. Supabase

1. Go to [supabase.com](https://supabase.com), create a free project.
2. **Region matters for GDPR (requirements Section 10.3)** — choose an EU or UK region if offered, to keep data residency clean. Note down which region you picked.
3. In the Supabase dashboard, go to **SQL Editor**, paste in the full contents of `supabase-schema.sql`, and run it. This creates every table, the RLS policies, and the CAC/AOV views.
4. Go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key (used by the frontend)
   - `service_role` key (used only server-side — never expose this in the browser)
5. Go to **Authentication → Providers** and set up email/password login (or whichever method you prefer) for owner/manager accounts.
6. After creating your own login, manually insert a row into `profiles` with your `auth.users` id and `role = 'owner'` so the RLS policies recognize you correctly. You can find your user id under **Authentication → Users**.

Add to your `.env` file:
```
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## 2. Fresha — Manual Export (MVP)

No API key needed at MVP — this is a manual weekly upload, per requirements Section 3.1.

1. Log into Fresha as the business owner.
2. Go to **Reports**, and export each of the following individually (CSV or XLSX):
   - Client Insights report
   - Sales/Appointments report
   - Performance Summary report
   - Service menu / price list
3. **Check permissions:** if exports aren't available, confirm your account has "Access reporting" enabled under Fresha's staff permissions.
4. Save exports somewhere consistent, e.g. a `fresha-exports/` folder on your machine, named clearly with the date (`client-insights-2026-08-18.csv`).
5. Upload each file through the app's own upload screen (not directly into Supabase) so validation (Section 3.1) runs before anything is committed to the warehouse.

**Weekly routine:** pick one day (e.g. every Monday morning) to run all exports and upload them. Consistency matters more than frequency here — the insight engine's "due in next 7 days" logic (Section 5.2) is built around a weekly cadence.

**Phase 2 note:** when you upgrade to Fresha's paid Data Connector (£190/month), this manual step gets replaced by a live sync — the ingestion adapter pattern (Section 8.1) means this is a contained swap, not a rebuild.

---

## 3. Meta Ads API

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in with the Facebook account tied to your ad account.
2. Create a new App (type: **Business**).
3. Under the app, add the **Marketing API** product.
4. Go to **Business Settings → System Users**, create a system user, and generate a long-lived access token with `ads_read` permission scoped to your ad account.
5. Note your **Ad Account ID** (found in Meta Ads Manager, format `act_XXXXXXXXX`).

Add to `.env`:
```
META_ACCESS_TOKEN=your_long_lived_token
META_AD_ACCOUNT_ID=act_XXXXXXXXX
```

**Token expiry:** long-lived tokens still expire (typically ~60 days). Set a calendar reminder to refresh it, or build the token-expiry monitoring alert flagged in requirements Section 8.1 sooner rather than later — this is the most common silent-failure point.

---

## 4. Google Ads API

1. Go to [Google Ads API Center](https://ads.google.com/aw/apicenter) from your Google Ads account and apply for a **Developer Token** (basic access is usually enough to start).
2. Go to [Google Cloud Console](https://console.cloud.google.com), create a project, and enable the **Google Ads API**.
3. Under **Credentials**, create an OAuth 2.0 Client ID (type: Desktop app).
4. Use Google's OAuth flow once locally to generate a **refresh token** (Google's official quickstart script handles this — see their Ads API docs).
5. Note your **Customer ID** (found top-right in Google Ads, format `XXX-XXX-XXXX`, remove dashes for API use).

Add to `.env`:
```
GOOGLE_ADS_DEVELOPER_TOKEN=your_dev_token
GOOGLE_ADS_CLIENT_ID=your_oauth_client_id
GOOGLE_ADS_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
GOOGLE_ADS_CUSTOMER_ID=XXXXXXXXXX
```

---

## 5. OpenAI API (LLM narration layer, Section 5.1)

1. Go to [platform.openai.com](https://platform.openai.com), create an account/organization if you don't have one.
2. Go to **API Keys** and generate a new secret key.
3. Add billing details — this is pay-as-you-go, not part of a ChatGPT subscription.
4. **GDPR note (requirements Section 10.3):** check OpenAI's current data processing terms for whether zero-data-retention is available on your account tier before sending real client data through — this matters for compliance, not just cost.

Add to `.env`:
```
OPENAI_API_KEY=your_secret_key
```

---

## 6. Mailchimp

1. Log into your existing Mailchimp account.
2. Go to **Account → Extras → API keys**, generate a new key.
3. Note your **Audience/List ID** (Audience → Settings → Audience name and defaults).
4. At MVP, this is used for manual export of flagged client segments (requirements Section 6) — the API key is only strictly needed once you build the Phase 2 direct-push integration, but worth generating now so it's ready.

Add to `.env`:
```
MAILCHIMP_API_KEY=your_api_key
MAILCHIMP_AUDIENCE_ID=your_audience_id
MAILCHIMP_SERVER_PREFIX=usXX  # the part after the dash in your API key, e.g. us21
```

---

## 7. Full `.env` Checklist

Create a `.env` file in the project root (never commit this — confirm it's in `.gitignore`):

```
# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Meta Ads
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=

# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=

# OpenAI
OPENAI_API_KEY=

# Mailchimp
MAILCHIMP_API_KEY=
MAILCHIMP_AUDIENCE_ID=
MAILCHIMP_SERVER_PREFIX=
```

---

## 8. Verifying Everything's Connected

Once credentials are in place, a good order to test in:
1. Supabase — confirm you can log in to the app and see your `owner` role reflected (no data yet, that's fine)
2. Fresha upload — upload one small real export and confirm it appears in `import_batches` with `status = 'committed'`
3. Meta/Google — trigger a manual sync and confirm rows appear in `ad_spend_daily`
4. OpenAI — trigger any AI-generated summary and confirm it returns text without an auth error
5. Mailchimp — confirm the API key authenticates (a simple "list audiences" call is enough to verify)

If anything fails, check the specific service's token/permission scope first — auth errors are by far the most common issue at this stage.
