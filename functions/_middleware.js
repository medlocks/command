// Cloudflare Pages Function — site-wide HTTP Basic Auth, added 2 Sep 2026
// as the fastest reasonable stopgap for putting this app on a real public
// URL before real login/auth exists (Requirements Section 10's still-open
// access-control question). Runs at the edge in front of every request —
// static assets, the PWA manifest/service worker, everything — entirely
// separate from the app itself; the app has no knowledge this exists.
// The password lives as a Pages secret (`SITE_PASSWORD`), never committed,
// set via `wrangler pages secret put`.
export async function onRequest(context) {
  const password = context.env.SITE_PASSWORD;
  if (!password) {
    // Fail closed, not open — a missing secret must never mean "no auth".
    return new Response('Site password not configured.', { status: 500 });
  }

  const auth = context.request.headers.get('Authorization');
  const expected = 'Basic ' + btoa(`medlocks:${password}`);

  if (auth !== expected) {
    return new Response('Authentication required.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="MedLocks Command Centre"' },
    });
  }

  return context.next();
}
