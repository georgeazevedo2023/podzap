#!/usr/bin/env node
/**
 * Promote a user to superadmin (cross-tenant admin).
 *
 * Usage:
 *   node --env-file=.env.local scripts/set-superadmin.mjs <email> [--password <pw>] [--note "<str>"]
 *
 * Flow:
 *   1. Look up the user via Supabase Admin API (requires SERVICE_ROLE_KEY).
 *   2. Optionally update their password (email_confirm forced true).
 *   3. Insert/upsert them into `public.superadmins` via Management API
 *      (service_role bypasses RLS, but we use Management API so the script
 *      is self-contained and matches db-query.mjs's transport).
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
 */

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { email: null, password: null, note: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--password' && args[i + 1]) {
      out.password = args[++i];
    } else if (a === '--note' && args[i + 1]) {
      out.note = args[++i];
    } else if (!a.startsWith('--') && !out.email) {
      out.email = a;
    }
  }
  return out;
}

function sqlEscape(str) {
  if (str === null || str === undefined) return 'null';
  // Escape single quotes by doubling them (standard Postgres literal escape).
  return `'${String(str).replace(/'/g, "''")}'`;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;

  const missing = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!mgmtToken) missing.push('SUPABASE_ACCESS_TOKEN');
  if (!projectRef) missing.push('SUPABASE_PROJECT_REF');
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    return 1;
  }

  const { email, password, note } = parseArgs(process.argv);
  if (!email) {
    console.error(
      'Usage: node --env-file=.env.local scripts/set-superadmin.mjs <email> [--password <pw>] [--note "<str>"]',
    );
    return 1;
  }

  // --- 1) Look up user by email ------------------------------------------
  const lookupUrl = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const lookupRes = await fetch(lookupUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Connection: 'close',
    },
  });

  if (!lookupRes.ok) {
    console.error(`Lookup failed: HTTP ${lookupRes.status}`);
    console.error((await lookupRes.text()).slice(0, 2000));
    return 1;
  }

  const lookupBody = await lookupRes.json();
  // Admin API returns { users: [...] } (paginated) — filter by email explicitly
  // because some Supabase versions return all users when the email filter is
  // ignored.
  const users = Array.isArray(lookupBody?.users) ? lookupBody.users : [];
  const user = users.find(
    (u) => typeof u?.email === 'string' && u.email.toLowerCase() === email.toLowerCase(),
  );

  if (!user) {
    console.error(
      `User not found: ${email}. Faça login primeiro via /login pra criar a conta.`,
    );
    return 1;
  }

  console.log(`Found user ${user.email} (${user.id})`);

  // --- 2) Optionally update password -------------------------------------
  if (password) {
    const updUrl = `${supabaseUrl}/auth/v1/admin/users/${user.id}`;
    const updRes = await fetch(updUrl, {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Connection: 'close',
      },
      body: JSON.stringify({ password, email_confirm: true }),
    });

    if (!updRes.ok) {
      console.error(`Password update failed: HTTP ${updRes.status}`);
      console.error((await updRes.text()).slice(0, 2000));
      return 1;
    }
    console.log('Password updated (email_confirm: true)');
  }

  // --- 3) Insert/upsert superadmin row via Management API ----------------
  const notePart = note === null ? 'null' : sqlEscape(note);
  const insertSql = `insert into public.superadmins(user_id, note) values (${sqlEscape(user.id)}, ${notePart}) on conflict (user_id) do update set note = excluded.note returning *`;

  const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const mgmtRes = await fetch(mgmtUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgmtToken}`,
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    body: JSON.stringify({ query: insertSql }),
  });

  if (!mgmtRes.ok) {
    console.error(`Superadmin upsert failed: HTTP ${mgmtRes.status}`);
    console.error((await mgmtRes.text()).slice(0, 2000));
    return 1;
  }

  const row = await mgmtRes.json();
  console.log(
    `OK  ${email} is superadmin.${password ? ' Password updated.' : ''}`,
  );
  console.log(JSON.stringify(row, null, 2));
  return 0;
}

// process.exitCode (not process.exit) so Node drains async handles naturally
// instead of libuv UV_HANDLE_CLOSING tear-down on Windows (see db-query.mjs).
main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err); process.exitCode = 1; });
