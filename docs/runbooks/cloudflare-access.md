# Cloudflare Access Runbook

This runbook configures and operates identity for the private
`surfcams-portugal` Worker. Follow it together with the
[release runbook](cloudflare-release.md) and the
[approved migration design](../superpowers/specs/2026-08-19-private-meo-worker-migration-design.md).

## Security Model

Cloudflare Access protects the complete production `workers.dev` hostname and
authorizes one exact-email allowlist. Google's identity provider proves who is
signing in; merely having a Google account is not authorization.

The Worker adds defense in depth for `/api/*`: it independently validates the
Access JWT signature, issuer, audience, and expiry. It does **not** authorize
the email in that JWT. Do not move the exact-email policy into Worker code, and
do not treat a cryptographically valid assertion as a substitute for the outer
Access allow policy.

Keep these values in their one approved location:

| Value | Approved location |
| --- | --- |
| Google OAuth client ID and client secret | Cloudflare Access Google identity-provider configuration only |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Worker secret |
| `ACCESS_AUD` | Cloudflare Worker secret |
| Approved email addresses | Cloudflare Access exact-email policy only |

In particular, the Google OAuth client secret exists only in Cloudflare
Access. Do not place it in Git, GitHub, a Worker binding, a build variable, a
local dotenv file, a command line, or an operator record.

## 1. Configure Google's OAuth Application

1. Create or select the owner's Google Cloud project.
2. Configure the OAuth consent screen before creating the client:
   - app name, user-support email, and developer contact email;
   - **External** audience, so approved consumer Google accounts can sign in;
   - only the basic identity scopes required by Cloudflare's Google connector.
     Do not add sensitive or restricted scopes.
3. Set the publishing status to **In production** before family acceptance.
4. Create a Web application OAuth client.
5. For the Cloudflare team origin
   `https://<team-name>.cloudflareaccess.com`, configure:
   - authorized JavaScript origin:
     `https://<team-name>.cloudflareaccess.com`;
   - authorized redirect URI:
     `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`.
6. Copy the client ID and secret directly from Google into Cloudflare Zero
   Trust → Integrations → Identity providers → Google, then save.
7. Use Cloudflare's IdP test independently with the owner and the intended
   second consumer account before testing the Access policy.

### Testing-mode warning

Google OAuth **Testing** mode normally allows only listed test users, displays
a test-app warning, and expires authorization seven days after consent. Google
currently exempts requests limited to name, email, and profile through the
basic `openid`, `userinfo.email`, and `userinfo.profile` scopes (or equivalent
Sign in with Google scopes): under that exception, users need not be listed,
see no Testing warning, and do not receive the seven-day authorization expiry.

This connector must request only those basic identity scopes, but the approved
release configuration is still External/**In production**. Inspect the actual
requested scopes and consent behavior. If any additional scope is requested or
Google shows the Testing warning, list each test account exactly and record the
seven-day authorization limit. That Google limit is separate from the intended
seven-day Cloudflare Access session. Keep final acceptance blocked until the
app is In production; do not quietly treat repeated consent as normal family
login behavior.

## 2. Protect the Complete Worker Hostname

Do this while the Worker still serves only the deny-only bootstrap.

1. In Cloudflare Zero Trust, create a self-hosted Access application for the
   complete production Worker hostname. Protect the root and every path,
   including `/api/*`; do not scope the application to the API alone.
2. Set the application session duration to **seven days**.
3. Create one `Allow` policy and set its policy session duration to
   **seven days**.
4. Add an Include rule for each approved person's exact email address.
5. Require the configured Google identity provider.
6. Do not add `Everyone`, all Google users, an email-domain wildcard,
   country-only access, or any Bypass policy.
7. Keep email one-time PIN disabled unless one named approved person cannot
   use Google. The fallback procedure is below.

From the Access application, copy its audience tag. From the Access account,
copy the normalized team-domain origin. Enter both interactively as Worker
secrets so they do not appear in shell history:

```bash
npm exec -- wrangler secret put ACCESS_TEAM_DOMAIN
npm exec -- wrangler secret put ACCESS_AUD
```

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` configure only the Worker's independent
JWT verification. They do not contain or replace the exact-email authorization
policy.

## 3. Approve an Account

1. Add the person's complete, exact email to the Access `Allow` policy.
2. Save the policy and ask the person to open the protected hostname in a fresh
   private browser session.
3. Confirm they choose the matching Google account and reach the app.
4. Confirm the successful identity and application decision in Access logs.

Do not use a domain rule to make onboarding shorter. Repeat this procedure for
each person.

## 4. Remove an Account and Revoke Its Session

Permanent removal has two required actions, in this order:

1. Remove the exact email from the Access `Allow` policy and save it. This
   prevents a new application session.
2. In Cloudflare Zero Trust → Team & Resources → Users, select that user and
   choose Action → Revoke. This revokes the user's Access session across the
   account's applications. Removing the policy entry alone does not immediately
   erase an already-issued application token.
3. In a fresh private browser, verify that the removed account cannot start a
   new session. Verify that the previously active browser loses app and API
   access after revocation propagates.

Access revocation stops future application and broker requests; it cannot
recall an MEO URL already returned to an authorized browser. An already-issued
signed URL or active stream may remain usable for the observed maximum of
**24 hours** after Access revocation. The broker's 20-hour refresh boundary
does not shorten that provider-controlled exposure window.

## 5. Verify Logout

The app's Settings → **Sign out** action opens the application-domain logout
path:

```text
/cdn-cgi/access/logout
```

After using it, verify the application cookie is gone, the root returns to the
Access login flow, and a playback API request no longer reaches the Worker as
an authorized request. Logout is not permanent removal: a still-allowed email
can authenticate again.

## 6. Optional Exact-email PIN Fallback

Use email one-time PIN only when one named, already-approved person cannot use
Google.

1. Enable Cloudflare Access one-time PIN as an additional login method.
2. Keep the same exact email in the existing allow policy. Do not add an open
   policy for PIN users.
3. In a private browser, verify the code is delivered only to that intended
   mailbox and that the exact address is the one admitted in Access logs.
4. Verify an unlisted address cannot use PIN to enter.
5. Leave the application and policy session durations at seven days.

Disable PIN again when the fallback is no longer required. Changing login
method does not change the exact-email authorization requirement.

## 7. Acceptance Checklist

Before deploying functional assets, run only the checks the bootstrap can
support against both `/` and a known `/api/playback/<camera-id>` path:

- A fresh anonymous/incognito browser is intercepted by Access before it can
  receive the bootstrap response.
- An allowed owner reaches only the bounded bootstrap 503 after login.
- An unlisted Google account is denied.

After candidate deployment, and again in production, run the complete deployed
Access checks:

- A fresh anonymous/incognito browser is intercepted by Access before it can
  receive app content or an API response.
- The owner can sign in with the exact allowed Google account.
- An unlisted Google account is denied.
- Adding a second exact email allows it, and Access logs the expected account.
- Removing that email prevents a new session.
- Revoking its active session terminates existing app and API access.
- Settings → Sign out completes Cloudflare logout.
- If PIN fallback is enabled, only its named exact email succeeds.
- No anonymous response exposes HTML, runtime JSON, a token, signed URL,
  assertion detail, or upstream diagnostic body.

Prove the Worker's defense-in-depth cases with `npm run verify`, including its
Node/Workerd tests for missing, malformed, expired, wrong-issuer,
wrong-audience, and valid assertions. Do not inject fabricated Access
assertions into the deployed hostname: the bootstrap has no verifier, and the
configured Access layer either intercepts the request or supplies its own valid
assertion after login.

Never record actual email addresses, OAuth values, assertions, signed URLs, or
tokens in the release record or screenshots intended for publication.

## References

- [Cloudflare: Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Cloudflare: Access session management, revocation, and logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Google: External audience and Testing/In production behavior](https://support.google.com/cloud/answer/15549945)
