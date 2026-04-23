# Supabase Auth — podZAP (Fase 1)

podZAP uses Supabase Auth with **magic link (OTP via email)** as the only
sign-in method in Fase 1. No passwords. No social providers yet.

This doc covers the end-to-end auth flow, the Supabase-side configuration
we rely on, the automatic tenant bootstrap trigger, and how to develop
against all of it locally.

---

## Auth flow

```
 ┌─────────┐       (1) POST /login          ┌────────────────┐
 │ Browser │ ─────────────────────────────▶ │ Next.js server │
 │         │    email in form body          │   /login       │
 └─────────┘                                 └────────┬───────┘
      ▲                                               │
      │ (7) cookie set,                               │ (2) supabase.auth
      │      redirect /home                           │     .signInWithOtp({
      │                                               │       email, emailRedirectTo
      │                                               │         = origin + /auth/callback
      │                                               │     })
      │                                               ▼
      │                                      ┌────────────────┐
      │                                      │ Supabase Auth  │
      │                                      │  (GoTrue)      │
      │                                      └────────┬───────┘
      │                                               │ (3) emails magic link
      │                                               │     https://<project>.supabase.co
      │                                               │       /auth/v1/verify?token=...
      │                                               │       &redirect_to=.../auth/callback
      │                                               ▼
      │                                      ┌────────────────┐
      │                                      │  User's inbox  │
      │                                      └────────┬───────┘
      │                                               │ (4) user clicks link
      │                                               ▼
      │                                      ┌────────────────┐
      │                                      │ Supabase Auth  │
      │                                      │  (verifies)    │
      │                                      └────────┬───────┘
      │                                               │ (5) 302 redirect to
      │                                               │     /auth/callback?code=...
      │                                               ▼
      │                                      ┌────────────────┐
      └──── (6) exchangeCodeForSession ─────▶│ /auth/callback │
                                             │ route handler  │
                                             └────────────────┘
```

Key points:

- **PKCE flow.** `signInWithOtp` produces a `code` query param; the
  callback route calls `supabase.auth.exchangeCodeForSession(code)` to
  mint the session cookie. PKCE is the default for `@supabase/ssr`.
- **Session lives in cookies**, set by the server route handler via the
  `@supabase/ssr` helpers. `proxy.ts` refreshes the session on every
  request.
- **First signup = first login.** There's no separate "sign up" screen.
  `signInWithOtp({ shouldCreateUser: true })` creates the `auth.users`
  row on first email, which fires the `handle_new_user` trigger (see
  below) and auto-provisions a tenant.

---

## Configuration

All auth config is managed via the Supabase **Management API**
(`/v1/projects/<ref>/config/auth`). The script
`scripts/configure-auth.mjs` is the source of truth.

### Redirect URLs (allow-list)

Supabase only redirects the magic-link back to URLs on the project's
allow-list. Currently configured:

| Key | Value |
|---|---|
| `site_url` | `http://localhost:3001` |
| `uri_allow_list` | `http://localhost:3000/**, http://localhost:3001/**, http://localhost:3000/auth/callback, http://localhost:3001/auth/callback` |

Both `3000` and `3001` are in the list because Next.js sometimes falls
back to `3001` when `3000` is already in use (other local dev
processes). The `/**` wildcard covers `/auth/callback` and any future
deep-links post-login.

### Updating the allow-list

1. Edit `scripts/configure-auth.mjs` (change `site_url` or
   `uri_allow_list`).
2. Run:
   ```bash
   node --env-file=.env.local scripts/configure-auth.mjs
   ```
3. Verify in the dashboard → **Authentication → URL Configuration**.

The script is idempotent — it `PATCH`es the full config each time.

### Other knobs we set

- `mailer_otp_exp: 3600` — magic links valid for 60 minutes (default is
  short; 60min is friendlier for dev where you context-switch).
- `shouldCreateUser: true` is passed on the client call, not in auth
  config. Disabling it would require a separate invite flow.

To inspect current auth config:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/vqrqygyfsrjpzkaxjleo/config/auth | jq
```

---

## Trigger behavior — `handle_new_user`

Created in `db/migrations/0002_fixes.sql`. Fires **after insert on
`auth.users`** (i.e. any new signup, whether via magic link, email/pw,
or service_role admin insert).

What it does, as the new user:

1. Computes a tenant name:
   `raw_user_meta_data->>'full_name'` (if set) →
   `split_part(email, '@', 1)` →
   `'My workspace'`.
2. Inserts a new row into `public.tenants` (plan: `free`).
3. Inserts a `public.tenant_members` row with `role='owner'` linking
   the user to that tenant.

Why it's safe:

- `security definer` runs the function with the function owner's
  privileges, so it can write to `tenants` / `tenant_members` even
  though the anon key cannot.
- `search_path = ''` + fully-qualified identifiers prevents
  search-path hijacks (a classic Postgres `security definer` footgun).
- `tenants_insert` RLS policy is **dropped** in 0002, so no path other
  than this trigger can create tenants from the outside.

### Second+ tenant per user

**Not supported in Fase 1.** A user gets exactly one tenant (their
own), auto-created on signup. Joining another tenant requires an
invite flow (table `invites` + `accept_invite` RPC) which is in
backlog.

If you need to manually put a user in multiple tenants during
development (e.g. RLS testing), do it via `scripts/db-query.mjs` with
an `insert into public.tenant_members ...` statement, bypassing RLS
via the Management API.

---

## Development flow

### Signing up for the first time

1. Run `npm run dev` (app on `http://localhost:3000` or `3001`).
2. Open `/login` → enter a real email → submit.
3. Supabase sends a magic link (real email, real inbox).
4. Click the link → redirected to `/auth/callback` → session cookie
   set → redirected to `/home`.
5. Verify in the dashboard → **Authentication → Users** that the user
   exists, and in the **Table Editor → tenants** that a tenant with
   the email's local-part was created.

### Subsequent logins

Same as above — `/login` → email → magic link. There's no password.
If the user already exists, no new tenant is created (the trigger only
fires on insert).

### Using real emails in dev

By default Supabase uses a real SMTP sender and emails go to real
inboxes. Pros: end-to-end realistic. Cons: rate-limited, slower,
requires real email addresses.

### Optional — local email testing with Inbucket / Mailpit

If the emails become a bottleneck in dev (rate limits, flaky
deliveries, testing many accounts):

1. Install [Mailpit](https://github.com/axllent/mailpit) or
   [Inbucket](https://inbucket.org/) locally. Both expose a dumb SMTP
   server + web UI on `localhost`.
2. Configure the Supabase project to use custom SMTP pointing at your
   local server. This is **project-level** config —
   **Authentication → Emails → SMTP Settings** in the dashboard.
   Management-API endpoint exists too
   (`/v1/projects/<ref>/config/auth` with `smtp_*` fields) but the
   dashboard is faster for this one-off.
3. Open the Mailpit UI (`http://localhost:8025`), sign up from the
   app, and the magic-link email lands there instantly.
4. **Important:** this only works if the Supabase project can reach
   your local SMTP port. For a hosted Supabase project that's
   unlikely, so realistically you'd need to run Supabase locally too
   (`supabase start`), which is out of scope for Fase 1.

**Punchline:** for Fase 1 we use real emails. Mailpit/Inbucket is
documented as a later option if the email path becomes painful.

---

## Rate limits

Supabase enforces per-project OTP rate limits. Default (as of 2026) is
roughly:

| Limit | Default | Where |
|---|---|---|
| `rate_limit_otp` | **30 per hour** per project | Management API `config/auth` |
| `rate_limit_email_sent` | 30 per hour | same |
| Per-email cooldown | 60s between OTP sends to the same address | enforced by GoTrue |

Hitting these manifests as:
- "Email rate limit exceeded" from `signInWithOtp`, OR
- 429 responses in the Network tab.

### Bumping for dev

For Fase 1 testing (especially RLS E2E which creates/deletes many
users), you may want to raise the limits temporarily. Patch via the
Management API:

```bash
curl -X PATCH \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rate_limit_otp": 300, "rate_limit_email_sent": 300}' \
  https://api.supabase.com/v1/projects/vqrqygyfsrjpzkaxjleo/config/auth
```

Or temporarily add these fields to `scripts/configure-auth.mjs` and
re-run it. **Revert before production.**

For automated tests, prefer creating users via the service_role admin
API (`supabase.auth.admin.createUser()`), which does not count against
the OTP rate limit.
