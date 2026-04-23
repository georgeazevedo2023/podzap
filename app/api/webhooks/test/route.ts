/**
 * Dev-only webhook replay endpoint.
 *
 * Purpose:
 *   Run the FULL webhook pipeline (parse + handle + persist) against a
 *   recorded fixture, without needing ngrok or UAZAPI to fire a real event.
 *   Great for iterating on handler/persist logic and for smoke-testing the
 *   full stack before pointing UAZAPI at a public URL.
 *
 * Safety:
 *   Hard-gated by `NODE_ENV`. In production the route returns 404 so it is
 *   indistinguishable from a non-existent endpoint. The gate happens BEFORE
 *   any DB read or env access so there is no side-channel.
 *
 * Usage:
 *   curl -X POST http://localhost:3001/api/webhooks/test \
 *     -H 'content-type: application/json' \
 *     -d '{"fixture":"text"}'
 *
 *   # Override tenant resolution (otherwise picks the most recently created
 *   # whatsapp_instances row — fine for a solo dev environment):
 *   curl -X POST 'http://localhost:3001/api/webhooks/test?tenant=<uuid>' \
 *     -H 'content-type: application/json' \
 *     -d '{"fixture":"audio"}'
 *
 * Fixture substitution:
 *   Fixtures on disk use placeholders so they're valid JSON and portable:
 *     __TENANT_ID__            → `whatsapp_instances.tenant_id`
 *     __INSTANCE_UAZAPI_ID__   → `whatsapp_instances.uazapi_instance_id`
 *     __GROUP_JID__            → first monitored group for the tenant
 *                                (or first group if none monitored; the
 *                                `unmonitored` fixture intentionally points
 *                                at a bogus JID to exercise that path)
 *     __UNMONITORED_GROUP_JID__ → a known-unmonitored JID (bogus literal,
 *                                                          never resolves)
 *     __DIRECT_JID__           → `<phone>@s.whatsapp.net` (direct DM, not a
 *                                                          group — handler
 *                                                          should ignore)
 *
 *   The substitution is string-based over the whole JSON text — simpler
 *   than a deep-traversal and works because our fixture keys never contain
 *   double underscores.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseWebhookBody } from '@/lib/webhooks/validator';
import { handleWebhookEvent } from '@/lib/webhooks/handler';
import { createAdminClient } from '@/lib/supabase/admin';

const ALLOWED_FIXTURES = [
  'text',
  'audio',
  'image',
  'connection',
  'direct',
  'unmonitored',
] as const;
type FixtureName = (typeof ALLOWED_FIXTURES)[number];

function isFixtureName(v: unknown): v is FixtureName {
  return typeof v === 'string' && (ALLOWED_FIXTURES as readonly string[]).includes(v);
}

interface ResolvedContext {
  tenantId: string;
  uazapiInstanceId: string;
  groupJid: string;
}

/**
 * Resolve a tenant + instance + group to plug into the fixture. We accept an
 * optional `tenantId` from the query string; otherwise we pick the most
 * recently updated `whatsapp_instances` row. Also picks a group for that
 * tenant (preferring a monitored one) so the `text`/`audio`/`image` fixtures
 * land in a real row that the handler can resolve.
 */
async function resolveContext(
  tenantIdHint: string | null,
): Promise<{ ok: true; ctx: ResolvedContext } | { ok: false; reason: string }> {
  const supabase = createAdminClient();

  const instanceQuery = supabase
    .from('whatsapp_instances')
    .select('tenant_id, uazapi_instance_id')
    .order('updated_at', { ascending: false })
    .limit(1);
  const { data: inst, error: instErr } = tenantIdHint
    ? await instanceQuery.eq('tenant_id', tenantIdHint).maybeSingle()
    : await instanceQuery.maybeSingle();

  if (instErr) {
    return { ok: false, reason: `whatsapp_instances query failed: ${instErr.message}` };
  }
  if (!inst) {
    return {
      ok: false,
      reason: tenantIdHint
        ? `No whatsapp_instances row for tenant ${tenantIdHint}`
        : 'No whatsapp_instances row in DB. Seed one first.',
    };
  }

  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .select('uazapi_group_jid, is_monitored')
    .eq('tenant_id', inst.tenant_id)
    .order('is_monitored', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (groupErr) {
    return { ok: false, reason: `groups query failed: ${groupErr.message}` };
  }

  // Synthesise a JID if the tenant has no groups yet. The `text`/`audio`/
  // `image` fixtures will hit the "group not found" branch in the handler,
  // which is still a useful exercise of the pipeline.
  const groupJid = group?.uazapi_group_jid ?? '120363000000000000@g.us';

  return {
    ok: true,
    ctx: {
      tenantId: inst.tenant_id,
      uazapiInstanceId: inst.uazapi_instance_id,
      groupJid,
    },
  };
}

function substitute(raw: string, ctx: ResolvedContext): string {
  return raw
    .replaceAll('__TENANT_ID__', ctx.tenantId)
    .replaceAll('__INSTANCE_UAZAPI_ID__', ctx.uazapiInstanceId)
    .replaceAll('__GROUP_JID__', ctx.groupJid)
    .replaceAll('__UNMONITORED_GROUP_JID__', '120363999999999999@g.us')
    .replaceAll('__DIRECT_JID__', '5511999998888@s.whatsapp.net');
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const tenantHint = url.searchParams.get('tenant');

  let bodyJson: unknown;
  try {
    const text = await request.text();
    bodyJson = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Body must be JSON.' } },
      { status: 400 },
    );
  }

  const fixture = (bodyJson as { fixture?: unknown } | null | undefined)?.fixture;
  if (!isFixtureName(fixture)) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Body must be { fixture: one of ${ALLOWED_FIXTURES.join(' | ')} }`,
        },
      },
      { status: 400 },
    );
  }

  // Resolve tenant/instance/group.
  const ctxResult = await resolveContext(tenantHint);
  if (!ctxResult.ok) {
    return NextResponse.json(
      { error: { code: 'NO_INSTANCE', message: ctxResult.reason } },
      { status: 409 },
    );
  }

  // Load + substitute the fixture.
  const fixturePath = path.join(
    process.cwd(),
    'lib',
    'webhooks',
    'fixtures',
    `${fixture}.json`,
  );
  let rawText: string;
  try {
    rawText = await fs.readFile(fixturePath, 'utf8');
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Fixture not found: ${fixturePath} (${(err as Error).message})`,
        },
      },
      { status: 500 },
    );
  }
  const substituted = substitute(rawText, ctxResult.ctx);

  let payload: unknown;
  try {
    payload = JSON.parse(substituted);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Fixture JSON is malformed after substitution: ${(err as Error).message}`,
        },
      },
      { status: 500 },
    );
  }

  // Full pipeline: parseWebhookBody → handleWebhookEvent. Secret is bypassed
  // intentionally (this is the dev disparador).
  const parsed = parseWebhookBody(payload);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.reason,
          details: { fixture, context: ctxResult.ctx },
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await handleWebhookEvent(parsed.event);
    return NextResponse.json({
      ok: true,
      fixture,
      context: ctxResult.ctx,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        fixture,
        context: ctxResult.ctx,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
