# podZAP — Database migrations

This directory holds raw SQL migrations for the Supabase/Postgres database.

```
db/
├── README.md              (this file)
└── migrations/
    └── 0001_init.sql      initial schema: tables, RLS, indexes, triggers
```

Migrations are numbered (`0001_`, `0002_`, …) and must be applied in order.
Each file is idempotent where practical but assumes a clean database for
its own objects (tables, types, policies).

---

## Option A — Paste into the Supabase SQL editor

Fastest path for a first-time setup or one-off environment.

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and pick
   the podZAP project (ref `vqrqygyfsrjpzkaxjleo`).
2. Go to **SQL Editor → + New query**.
3. Copy the full contents of `migrations/0001_init.sql` and paste it.
4. Click **Run**. The script finishes in a few seconds and reports success.
5. Verify under **Table Editor** that `tenants`, `tenant_members`,
   `whatsapp_instances`, `groups`, `messages`, `transcripts`, `summaries`,
   `audios`, and `schedules` are present and have RLS enabled.

If you need to re-run after a failed partial apply, either drop the affected
objects manually or reset the database (**Project Settings → Database →
Reset database**) — the script does not include teardown statements.

---

## Option B — Supabase CLI (`supabase db push`)

Preferred for local/dev iteration and for CI. Requires the Supabase CLI
installed (`npm i -g supabase` or `scoop install supabase`).

1. **Link the project once per machine:**
   ```bash
   supabase link --project-ref vqrqygyfsrjpzkaxjleo
   ```
   The CLI reads `SUPABASE_ACCESS_TOKEN` from the environment — it is
   already defined in `.env.local` at the repo root, so either export it
   first (`set -a; source .env.local; set +a` on bash, or load via your
   tooling) or run the command from a shell where the var is visible.

2. **Make sure the migration file is in the expected place.** The CLI
   looks under `supabase/migrations/` by default. Our canonical source of
   truth lives in `db/migrations/`. Easiest approach: symlink or copy
   before pushing:

   ```bash
   mkdir -p supabase/migrations
   cp db/migrations/0001_init.sql supabase/migrations/0001_init.sql
   ```

   (We keep the original under `db/` because the Next.js app treats
   `supabase/` as CLI scratch space. A later chore migration can unify.)

3. **Push:**
   ```bash
   supabase db push
   ```
   The CLI diff-applies anything not yet present on the remote project.

4. **Optional — verify from the CLI:**
   ```bash
   supabase db remote commit   # dumps remote state for sanity diff
   ```

---

## Notes

- `SUPABASE_ACCESS_TOKEN` is already set in `.env.local` (personal access
  token with permission on project `vqrqygyfsrjpzkaxjleo`). Do not commit
  it; `.env.local` is gitignored.
- RLS is enabled on every table. Background workers (Inngest functions,
  UAZAPI webhook handler) must use the **service_role** Supabase client
  to bypass RLS. App clients (browser/server components) use
  **anon/authenticated** and are subject to tenant-scoped policies.
- Signup currently does *not* auto-create a tenant — see the TODO block
  at the bottom of `0001_init.sql` for the planned `handle_new_user`
  trigger in a future migration.
- Seed data is intentionally out of scope for this migration. A separate
  `seed.sql` will be added once the minimal Next.js scaffold exists.
