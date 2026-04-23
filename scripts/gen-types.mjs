#!/usr/bin/env node
/**
 * Regenerate Supabase TypeScript types via Management API.
 *
 * Usage: node --env-file=.env.local scripts/gen-types.mjs
 * Writes to lib/supabase/types.ts
 */
import fs from 'node:fs';

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!ref || !token) {
  console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const url = `https://api.supabase.com/v1/projects/${ref}/types/typescript?included_schemas=public`;
const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    // See db-query.mjs — forces keep-alive socket closed so Node on
    // Windows doesn't hit `UV_HANDLE_CLOSING` at shutdown.
    Connection: 'close',
  },
});

const text = await res.text();
console.log('HTTP', res.status);
if (!res.ok) {
  console.error(text.slice(0, 2000));
  process.exitCode = 1;
}

let body;
try {
  body = JSON.parse(text);
} catch {
  body = null;
}

const code = body && typeof body.types === 'string' ? body.types : text;
fs.writeFileSync('lib/supabase/types.ts', code, 'utf8');
console.log(`Wrote lib/supabase/types.ts (${code.length} bytes)`);
