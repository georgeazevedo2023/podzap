# podZAP — Database migrations

This directory holds raw SQL migrations for the Supabase/Postgres database
backing podZAP. Migrations are numbered (`0001_`, `0002_`, …) and must be
applied in order.

```
db/
├── README.md              (this file)
└── migrations/
    ├── 0001_init.sql      initial schema: tables, RLS, indexes, triggers
    └── 0002_fixes.sql     Fase-0 blockers + Fase-1 auth trigger (handle_new_user)
```

Each file is idempotent where practical (uses `if not exists`, `drop policy
if exists`, etc.) but assumes the previous migration has already been applied.

---

## Connection info

| | |
|---|---|
| Project ref | `vqrqygyfsrjpzkaxjleo` |
| Dashboard | https://supabase.com/dashboard/project/vqrqygyfsrjpzkaxjleo |
| DATABASE_URL pattern | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| Required env | `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` in `.env.local` |

`SUPABASE_ACCESS_TOKEN` is a personal access token (dashboard →
Account → Access Tokens). It is distinct from the anon/service keys and
is what lets the scripts in `scripts/` call the Supabase Management API.

---

## How migrations are applied here

We apply migrations via the **Supabase Management API**, not the
`supabase` CLI. This keeps the flow scriptable without needing the CLI on
every machine.

### Primary path — `scripts/db-query.mjs`

```bash
node --env-file=.env.local scripts/db-query.mjs db/migrations/0001_init.sql
node --env-file=.env.local scripts/db-query.mjs db/migrations/0002_fixes.sql
```

The script `POST`s the SQL to
`https://api.supabase.com/v1/projects/<ref>/database/query` using
`SUPABASE_ACCESS_TOKEN`. It exits non-zero on HTTP errors.

Ad-hoc SQL works too:

```bash
node --env-file=.env.local scripts/db-query.mjs --sql "select now()"
```

### Alternate 1 — Supabase SQL Editor (dashboard)

1. Open the dashboard (link above) → **SQL Editor → + New query**.
2. Paste the full contents of the migration file.
3. Click **Run**.
4. Verify under **Table Editor** that all 9 tables exist and show RLS
   enabled.

Useful when you need to inspect results interactively or when you don't
have `.env.local` handy.

### Alternate 2 — Supabase CLI (`supabase db push`)

Documented for completeness; **we do not use this by default**. If you
want to try it:

```bash
npm i -g supabase                                  # install CLI
supabase link --project-ref vqrqygyfsrjpzkaxjleo   # reads SUPABASE_ACCESS_TOKEN
mkdir -p supabase/migrations
cp db/migrations/*.sql supabase/migrations/
supabase db push
```

Trade-offs vs. the Management API path:

- Requires the CLI installed and a linked project.
- The CLI expects migrations under `supabase/migrations/`; ours live in
  `db/migrations/`. You have to mirror or symlink.
- Does diff-based pushes, which is nice for multi-file changes but
  opaque compared to the single-file POST we do today.

If we ever move to shadow DB / migration diffing, we'll revisit this.

---

## Regenerate TypeScript types

After any migration that changes schema, regenerate `lib/supabase/types.ts`:

```bash
node --env-file=.env.local scripts/gen-types.mjs
```

The script hits `/v1/projects/<ref>/types/typescript?included_schemas=public`
and writes the result to `lib/supabase/types.ts`.

---

## Verify schema state

Quick check that all tables are present:

```bash
node --env-file=.env.local scripts/db-query.mjs --sql \
  "select table_name from information_schema.tables where table_schema='public' order by table_name"
```

Expected output (post-0002): `audios, groups, messages, schedules,
summaries, tenant_members, tenants, transcripts, whatsapp_instances`.

Other useful one-liners:

```bash
# Check that RLS is on for every table
node --env-file=.env.local scripts/db-query.mjs --sql \
  "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname"

# Confirm handle_new_user trigger is attached to auth.users
node --env-file=.env.local scripts/db-query.mjs --sql \
  "select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal"
```

---

## Current migration list

| File | Summary |
|---|---|
| `0001_init.sql` | Creates ENUMs, the 9 core tables (`tenants`, `tenant_members`, `whatsapp_instances`, `groups`, `messages`, `transcripts`, `summaries`, `audios`, `schedules`), `updated_at` trigger, and tenant-scoped RLS policies. |
| `0002_fixes.sql` | Fase-0 blockers + Fase-1 auth: drops the permissive `tenants_insert` policy, adds `handle_new_user()` trigger on `auth.users` (auto-creates tenant + owner membership on signup), scopes `messages.uazapi_message_id` unique to `(tenant_id, uazapi_message_id)`, hardens `set_updated_at()` (`security definer` + empty `search_path`), adds `current_tenant_ids()` helper and rewires every RLS policy to use it, adds two hot-path indexes (`messages(group_id, type, captured_at desc)`, partial `audios(delivered_to_whatsapp=false)`). |

---

## Creating a new migration

1. **Filename convention:** `NNNN_short_description.sql`, zero-padded to
   4 digits, incremented from the last one (`0003_…` next).
2. **Header:** include a comment block that lists the issues / audit
   items the migration addresses (see `0002_fixes.sql` for the pattern).
3. **One concern per file** is ideal, but grouping related fixes
   (à la `0002_fixes.sql`) is fine when they ship together.
4. **Comment every non-trivial change** with rationale. The SQL is the
   source of truth for why the database is shaped the way it is.
5. **Prefer additive changes** (new tables/columns/policies). When
   dropping policies, use `drop policy if exists` so the file stays
   re-runnable.
6. **Apply locally first:**
   ```bash
   node --env-file=.env.local scripts/db-query.mjs db/migrations/0003_your_change.sql
   ```
7. **Regenerate types:**
   ```bash
   node --env-file=.env.local scripts/gen-types.mjs
   ```
8. Commit the `.sql` file and the updated `lib/supabase/types.ts` together.

---

## Troubleshooting

**`PGRST205 Could not find the table 'public.X' in the schema cache`**
Schema cache is stale or the table wasn't created. Re-apply the latest
migration and, if still failing, hit the dashboard's "Reload schema"
button (API Settings). Usually means a migration failed halfway.

**`permission denied for schema auth`** (when applying `0002_fixes.sql`)
The `handle_new_user()` trigger is attached to `auth.users`, which needs
`security definer` on the function and the function must be owned by a
role with privileges on `auth`. Via the Management API this works
because the request runs as the project owner. If you're applying via a
CLI with a restricted role, re-run from the dashboard SQL Editor (which
also runs as owner).

**Auth callback redirects to `?error=...`**
The redirect URL isn't in the project's allow-list. Re-run
`node --env-file=.env.local scripts/configure-auth.mjs` to patch the
allow-list to include `http://localhost:3000/**` and `3001/**`. See
`docs/integrations/supabase-auth.md` for details.

**Migration partially applied, need to re-run**
Most statements in `0002_fixes.sql` use `drop … if exists` /
`create … if not exists` and can be re-run safely. For `0001_init.sql`
(no guards on most `create table` statements), the fastest path is
**Project Settings → Database → Reset database** in the dashboard
followed by a fresh apply. Only do this on a dev project.

**`SUPABASE_ACCESS_TOKEN` works in the dashboard but `db-query.mjs`
returns 401**
Make sure you're running with `--env-file=.env.local` — Node 20.6+ is
required for that flag. Older Node ignores it silently and the script
sees an empty env.

---

## Notes

- **RLS bypass:** service_role key bypasses RLS. Background workers
  (Inngest, UAZAPI webhook handler) use service_role. App clients
  (browser / server components) use anon/authenticated and are subject
  to policies.
- **Seed data:** intentionally not included. When we need fixtures for
  E2E tests or local dev, a separate `db/seed.sql` will be added.
- **First signup behavior:** since 0002, inserting a row into
  `auth.users` (normal signup flow) fires `handle_new_user()` which
  creates one tenant named after the user's email local-part and an
  `owner` membership. See `docs/integrations/supabase-auth.md`.
