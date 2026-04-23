#!/usr/bin/env bash
# =====================================================================
# podZAP — Supabase onboarding script
# =====================================================================
# Idempotent setup for a fresh dev checkout:
#   1. Verifies .env.local has SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
#   2. Applies every SQL migration under db/migrations/ in order
#   3. PATCHes auth redirect URLs via Management API
#   4. Regenerates lib/supabase/types.ts
#
# Safe to re-run — migrations use `if not exists` / `drop … if exists`
# guards, and the auth config PATCH is already idempotent.
#
# Executable bit note:
#   On Windows the chmod +x is a no-op. If you're committing this file,
#   run once from bash:
#     git update-index --chmod=+x scripts/setup-supabase.sh
#   so the mode is recorded in the index.
# =====================================================================

set -e

# Resolve repo root (the script lives in scripts/ so .. is the repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- 1. Env check -----------------------------------------------------
if [ ! -f .env.local ]; then
  echo "Missing .env.local at repo root. Copy .env.example and fill values."
  exit 1
fi

if ! grep -q '^SUPABASE_ACCESS_TOKEN=' .env.local; then
  echo "Missing SUPABASE_ACCESS_TOKEN in .env.local"
  echo "  Get one from https://supabase.com/dashboard/account/tokens"
  exit 1
fi

if ! grep -q '^SUPABASE_PROJECT_REF=' .env.local; then
  echo "Missing SUPABASE_PROJECT_REF in .env.local (should be vqrqygyfsrjpzkaxjleo)"
  exit 1
fi

# --- 2. Apply migrations ---------------------------------------------
echo "==> Applying migrations..."
shopt -s nullglob
for f in db/migrations/*.sql; do
  echo "  - $f"
  if ! node --env-file=.env.local scripts/db-query.mjs "$f"; then
    echo "    (non-zero exit; may already be applied — check output above)"
  fi
done
shopt -u nullglob

# --- 3. Auth config ---------------------------------------------------
echo "==> Configuring auth redirect URLs..."
node --env-file=.env.local scripts/configure-auth.mjs

# --- 4. Regenerate types ----------------------------------------------
echo "==> Regenerating lib/supabase/types.ts..."
node --env-file=.env.local scripts/gen-types.mjs

echo ""
echo "==> Done. Run 'npm run dev' to start."
