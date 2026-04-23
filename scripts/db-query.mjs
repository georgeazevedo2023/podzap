#!/usr/bin/env node
/**
 * Apply a SQL file to the Supabase project via Management API.
 *
 * Usage:
 *   node --env-file=.env.local scripts/db-query.mjs <file.sql>
 *   node --env-file=.env.local scripts/db-query.mjs --sql "select 1"
 *
 * Requires: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN
 */
import fs from 'node:fs';

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!ref || !token) {
    console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in env');
    return 1;
  }

  const args = process.argv.slice(2);
  let query;

  if (args[0] === '--sql' && args[1]) {
    query = args[1];
  } else if (args[0] && !args[0].startsWith('--')) {
    query = fs.readFileSync(args[0], 'utf8');
  } else {
    console.error('Usage: node scripts/db-query.mjs <file.sql> | --sql "<sql>"');
    return 1;
  }

  const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Force the socket closed after this single request. Without this,
      // Node on Windows sometimes prints:
      //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
      // at shutdown because libuv tries to close a keep-alive socket
      // that the undici global dispatcher already closed.
      Connection: 'close',
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 5000));
  return res.ok ? 0 : 1;
}

// Use process.exitCode (not process.exit) so Node drains async handles
// naturally instead of being torn down mid-close by libuv on Windows.
main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err); process.exitCode = 1; });
