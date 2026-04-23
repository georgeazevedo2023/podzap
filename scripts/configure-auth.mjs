#!/usr/bin/env node
/**
 * Configure Supabase Auth redirect URLs + site URL via Management API.
 *
 * Usage:
 *   node --env-file=.env.local scripts/configure-auth.mjs
 */
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!ref || !token) {
  console.error('Missing env');
  process.exit(1);
}

const body = {
  site_url: 'http://localhost:3001',
  uri_allow_list: [
    'http://localhost:3000/**',
    'http://localhost:3001/**',
    'http://localhost:3000/auth/callback',
    'http://localhost:3001/auth/callback',
  ].join(','),
  // Give magic-links a longer window in dev
  mailer_otp_exp: 3600,
};

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    // See db-query.mjs — forces keep-alive socket closed so Node on
    // Windows doesn't hit `UV_HANDLE_CLOSING` at shutdown.
    Connection: 'close',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 2000));
process.exitCode = res.ok ? 0 : 1;
