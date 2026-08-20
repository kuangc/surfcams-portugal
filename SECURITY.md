# Security Policy

## Supported Versions

This is a private personal application. Security fixes are handled on the
default branch and released through the Access-protected Cloudflare Worker.

## Reporting a Vulnerability

Open a private advisory or contact the repository owner directly if you find a
vulnerability. Do not include credentials, Access assertions, MEO tokens, or
signed playlist URLs in a public issue.

## Authentication and Authorization

Cloudflare Access protects the complete production hostname, including static
assets and `/api/*`. Its primary Google `Allow` policy and any separately
scoped, named one-time-PIN fallback policies are the authorization control.
Every `Allow` policy contains only exact approved email addresses and requires
its intended login method. `Everyone`, domain wildcards, country-only rules,
and bypass policies are not acceptable substitutes.

The playback API applies a separate defense-in-depth check to the
`Cf-Access-Jwt-Assertion` header. Worker code validates the JWT signature
against Cloudflare's JWKS and requires the configured issuer, audience, and
expiry. It intentionally does **not** authorize the JWT's email claim; exact
email authorization remains Cloudflare Access's responsibility. Both layers
must remain enabled.

Normal Access application and policy sessions last seven days. Permanent
removal requires both deleting the exact email from every allow policy that
contains it, including any named one-time-PIN fallback policy, and revoking
that user's current Access session. The visible app logout action uses
`/cdn-cgi/access/logout` to clear the Access session. Removing or logging out a
user prevents further app and broker access, but it cannot recall media already
issued by MEO.

An already-issued signed MEO URL or active stream may remain usable after
Access revocation until the provider token expires. The maximum observed on
2026-08-19 was 24 hours. The broker's conservative 20-hour refresh boundary is
not a guarantee of earlier invalidation.

## Secrets and Sensitive Values

- The Google OAuth client secret exists only in Cloudflare Access's Google
  identity-provider configuration. It must never enter the Worker, repository,
  GitHub settings, command history, or release record.
- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker secrets. Set them through
  `wrangler secret put`; never commit their production values.
- The MEO token is short-lived provider output, not a deployment secret. Only
  the named Durable Object stores it. The browser receives a signed URL and
  opaque revision in memory only.
- Never log or persist an Access JWT, MEO token, signed URL or query,
  `wmsAuthSign`, `nimblesessionid`, request headers, upstream response body, or
  detailed viewing history. Errors and manual probes must remain bounded and
  redacted.
- The playback API accepts a canonical camera ID only. It must never accept a
  caller-provided upstream URL, fall back to unsigned MEO playback, proxy MEO
  media, or substitute Surfline camera media.

## Data Boundaries

Camera metadata is crawled from external pages and is untrusted until the
identity/feed validator accepts it. Production packaging is an explicit
allowlist and excludes repository history, tests, caches, documentation,
development fixtures, and local secrets.

Favorites and surf preferences remain in browser `localStorage`. The first
release on the new protected origin intentionally starts with fresh defaults;
there is no cross-origin migration from the legacy GitHub Pages site.

See the [approved migration design](docs/superpowers/specs/2026-08-19-private-meo-worker-migration-design.md)
and the [Access runbook](docs/runbooks/cloudflare-access.md) for the complete
trust and revocation model.
