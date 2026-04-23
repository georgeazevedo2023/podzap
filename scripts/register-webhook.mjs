#!/usr/bin/env node
/**
 * Register (upsert) the podZAP webhook URL on a UAZAPI instance.
 *
 * Why this exists:
 *   UAZAPI needs a publicly reachable HTTPS URL to deliver events. In dev
 *   that means ngrok/cloudflared. Rather than POST'ing to UAZAPI manually
 *   via curl every time the tunnel URL changes, this script reads the
 *   admin + per-instance tokens from env/DB and calls `POST /webhook`
 *   (verified against wsmart.uazapi.com 2026-04-22).
 *
 * Secret transport:
 *   We embed `?secret=<UAZAPI_WEBHOOK_SECRET>` in the URL because UAZAPI's
 *   `POST /webhook` doesn't support registering custom headers for
 *   callbacks — it round-trips whatever query string we register. The
 *   webhook validator accepts both `?secret=` and `x-uazapi-secret`
 *   header, so first-party / test callers can still use the header path.
 *
 * Idempotent:
 *   GET /webhook first. If any existing config has the exact same URL,
 *   log + skip. Otherwise POST /webhook with the new config. The server
 *   replaces the configured set each POST (it's not additive), so we
 *   preserve any previously-configured URLs by including them in the
 *   `excludeMessages`-free POST... actually the server doesn't take a
 *   list — each POST configures ONE URL. We accept that: running this
 *   against a new ngrok URL will replace any older dev tunnel. That's
 *   usually what you want, and we log a warning so it's not silent.
 *
 * Usage:
 *   node --env-file=.env.local scripts/register-webhook.mjs https://abc.ngrok.io
 *
 *   # Optional: target a specific instance (default = most recent row).
 *   node --env-file=.env.local scripts/register-webhook.mjs \
 *     https://abc.ngrok.io \
 *     --instance <uuid>
 *
 *   # Optional: customise events (default: messages + connection)
 *   node --env-file=.env.local scripts/register-webhook.mjs \
 *     https://abc.ngrok.io \
 *     --events messages,connection,status
 *
 * Requirements:
 *   - UAZAPI_BASE_URL
 *   - UAZAPI_ADMIN_TOKEN          (only needed if we end up calling admin endpoints)
 *   - UAZAPI_WEBHOOK_SECRET
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - ENCRYPTION_KEY              (to decrypt per-instance token from DB)
 */

import { createClient } from '@supabase/supabase-js';
import {
  createDecipheriv,
} from 'node:crypto';

/* ------------------------------------------------------------------ */
/*  Symmetric decrypt (mirrors lib/crypto.ts — kept in sync manually)  */
/* ------------------------------------------------------------------ */

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decryptToken(payload) {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  const parts = String(payload).split('.');
  if (parts.length !== 3) throw new Error('Encrypted token must be "<iv>.<ct>.<tag>"');
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES) throw new Error('Bad IV length');
  if (tag.length !== TAG_BYTES) throw new Error('Bad tag length');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}

/* ------------------------------------------------------------------ */
/*  Arg parsing                                                        */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    throw new Error(
      'Usage: node scripts/register-webhook.mjs <base-url> [--instance <uuid>] [--events messages,connection]',
    );
  }
  const baseUrl = args[0].replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(`base-url must start with http(s)://, got: ${baseUrl}`);
  }
  let instance = null;
  let events = ['messages', 'connection'];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--instance' && args[i + 1]) {
      instance = args[i + 1];
      i++;
    } else if (args[i] === '--events' && args[i + 1]) {
      events = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    }
  }
  return { baseUrl, instance, events };
}

/* ------------------------------------------------------------------ */
/*  Thin UAZAPI calls (webhook-scoped only; no need for the full client)*/
/* ------------------------------------------------------------------ */

async function uazapiGetWebhooks(uazapiBase, instanceToken) {
  const res = await fetch(`${uazapiBase.replace(/\/+$/, '')}/webhook`, {
    method: 'GET',
    headers: { Accept: 'application/json', token: instanceToken },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /webhook failed: ${res.status} ${text}`);
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

async function uazapiSetWebhook(uazapiBase, instanceToken, config) {
  const res = await fetch(`${uazapiBase.replace(/\/+$/, '')}/webhook`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      token: instanceToken,
    },
    body: JSON.stringify({
      url: config.url,
      events: config.events,
      enabled: true,
      addUrlEvents: false,
      addUrlTypesMessages: false,
      excludeMessages: [],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /webhook failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const { baseUrl: publicBase, instance: instanceHint, events } = parsed;

  const uazapiBase = process.env.UAZAPI_BASE_URL;
  const secret = process.env.UAZAPI_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!uazapiBase) missing.push('UAZAPI_BASE_URL');
  if (!secret) missing.push('UAZAPI_WEBHOOK_SECRET');
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    return 1;
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const q = sb
    .from('whatsapp_instances')
    .select('id, tenant_id, uazapi_instance_id, uazapi_token_encrypted')
    .order('updated_at', { ascending: false })
    .limit(1);
  const { data: row, error } = instanceHint
    ? await q.eq('id', instanceHint).maybeSingle()
    : await q.maybeSingle();

  if (error) {
    console.error(`whatsapp_instances query failed: ${error.message}`);
    return 1;
  }
  if (!row) {
    console.error(
      instanceHint
        ? `No whatsapp_instances row with id=${instanceHint}`
        : 'No whatsapp_instances rows in DB. Create one via the app first.',
    );
    return 1;
  }
  if (!row.uazapi_token_encrypted) {
    console.error(`Instance ${row.id} has no uazapi_token_encrypted — cannot register webhook`);
    return 1;
  }

  let instanceToken;
  try {
    instanceToken = decryptToken(row.uazapi_token_encrypted);
  } catch (err) {
    console.error(`Failed to decrypt instance token: ${err.message}`);
    return 1;
  }

  const webhookUrl = `${publicBase}/api/webhooks/uazapi?secret=${encodeURIComponent(secret)}`;
  console.log(`Instance: ${row.id} (uazapi_id=${row.uazapi_instance_id}, tenant=${row.tenant_id})`);
  console.log(`Target URL: ${publicBase}/api/webhooks/uazapi?secret=*** (redacted)`);
  console.log(`Events: ${events.join(', ')}`);

  // Idempotency check.
  let existing;
  try {
    existing = await uazapiGetWebhooks(uazapiBase, instanceToken);
  } catch (err) {
    console.error(`Failed to read existing webhook config: ${err.message}`);
    return 1;
  }

  const alreadyRegistered = existing.find((cfg) => cfg && cfg.url === webhookUrl);
  if (alreadyRegistered) {
    console.log('Already registered with the same URL — nothing to do.');
    return 0;
  }

  if (existing.length > 0) {
    const urls = existing.map((c) => c.url).filter(Boolean);
    console.warn(
      `Note: ${existing.length} existing webhook config(s) will be replaced. Prior URLs: ${urls.join(', ')}`,
    );
  }

  try {
    const result = await uazapiSetWebhook(uazapiBase, instanceToken, {
      url: webhookUrl,
      events,
    });
    console.log('Webhook registered.');
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(`Registration failed: ${err.message}`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
