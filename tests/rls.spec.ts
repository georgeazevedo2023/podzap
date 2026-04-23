/**
 * RLS multi-tenant E2E test suite (podZAP).
 *
 * Proves that a user in tenant T1 cannot read or write data that belongs to
 * tenant T2 via the anon/authenticated Supabase API (RLS enforcement).
 *
 * Setup:
 *   - Service-role client (bypasses RLS) is used for fixtures & teardown.
 *   - Two users are created via supabase.auth.admin.createUser with
 *     email_confirm: true. Since F13 (migration 0008) dropped the
 *     self-service handle_new_user() trigger, the fixture provisions a
 *     tenant + owner tenant_members row manually via the service-role
 *     client — the same way the admin UI (/admin, F13 A4) will do it.
 *   - Each user signs in with password on a fresh anon client to obtain a
 *     scoped authenticated session.
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
}

// Admin (service_role) client. Disable session persistence: tests are
// stateless. The admin client bypasses RLS for setup/teardown.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function makeAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Unique identifiers per test run so reruns don't collide.
const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const emailA = `testuser-a-${suffix}@podzap.test`;
const emailB = `testuser-b-${suffix}@podzap.test`;
const passwordA = `PwA-${randomBytes(12).toString('hex')}`;
const passwordB = `PwB-${randomBytes(12).toString('hex')}`;

type Fixture = {
  userId: string;
  email: string;
  password: string;
  tenantId: string;
  client: SupabaseClient;
  instanceId?: string;
};

const state: { a?: Fixture; b?: Fixture } = {};

async function createUserAndFixture(
  email: string,
  password: string,
): Promise<Fixture> {
  // 1. Create user via admin (skips email confirmation loop).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`admin.createUser(${email}) failed: ${createErr?.message}`);
  }
  const userId = created.user.id;

  // 2. Provision tenant + owner membership via service-role (bypasses RLS).
  //    This replaces the old handle_new_user() trigger dropped in 0008.
  const tenantName = email.split('@')[0] ?? 'test-tenant';
  const { data: tenantRow, error: tenantErr } = await admin
    .from('tenants')
    .insert({ name: tenantName, plan: 'free' })
    .select('id')
    .single();
  if (tenantErr || !tenantRow) {
    throw new Error(
      `tenants.insert for ${email} failed: ${tenantErr?.message ?? 'no row'}`,
    );
  }
  const tenantId = tenantRow.id as string;

  const { error: memInsertErr } = await admin.from('tenant_members').insert({
    tenant_id: tenantId,
    user_id: userId,
    role: 'owner',
  });
  if (memInsertErr) {
    throw new Error(
      `tenant_members.insert for ${email} failed: ${memInsertErr.message}`,
    );
  }

  // 3. Sign the user in on a fresh anon client -> authenticated session.
  const client = makeAnonClient();
  const { error: signErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr) throw new Error(`signIn(${email}) failed: ${signErr.message}`);

  return { userId, email, password, tenantId, client };
}

// -----------------------------------------------------------------------------
// Setup & teardown
// -----------------------------------------------------------------------------

beforeAll(async () => {
  state.a = await createUserAndFixture(emailA, passwordA);
  state.b = await createUserAndFixture(emailB, passwordB);
}, 60_000);

afterAll(async () => {
  // Delete users (cascades to tenant_members via FK on delete cascade).
  // Then clean up tenants (not cascaded from auth.users).
  const tenantIds: string[] = [];
  for (const f of [state.a, state.b]) {
    if (!f) continue;
    tenantIds.push(f.tenantId);
    try {
      await admin.auth.admin.deleteUser(f.userId);
    } catch (err) {
      // Swallow: teardown is best-effort.
      console.warn(`deleteUser(${f.email}) failed:`, err);
    }
  }
  if (tenantIds.length > 0) {
    // Deleting the tenant cascades to whatsapp_instances, groups, messages,
    // summaries, audios, schedules (all have on delete cascade).
    const { error } = await admin.from('tenants').delete().in('id', tenantIds);
    if (error) console.warn('tenant cleanup failed:', error.message);
  }
}, 60_000);

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('RLS — multi-tenant isolation', () => {
  it('admin provisioning yields exactly one tenant + one owner membership', async () => {
    const a = state.a!;
    const b = state.b!;

    for (const f of [a, b]) {
      const { data: tenants, error: tErr } = await admin
        .from('tenants')
        .select('id, name')
        .eq('id', f.tenantId);
      expect(tErr).toBeNull();
      expect(tenants).toHaveLength(1);

      const { data: members, error: mErr } = await admin
        .from('tenant_members')
        .select('role, tenant_id, user_id')
        .eq('user_id', f.userId);
      expect(mErr).toBeNull();
      expect(members).toHaveLength(1);
      expect(members![0].role).toBe('owner');
      expect(members![0].tenant_id).toBe(f.tenantId);
    }
  });

  it("user A sees own tenant and cannot see B's tenant", async () => {
    const a = state.a!;
    const b = state.b!;

    const { data: visible, error } = await a.client
      .from('tenants')
      .select('id');
    expect(error).toBeNull();
    expect(visible).toBeTruthy();
    expect(visible!.length).toBe(1);
    expect(visible![0].id).toBe(a.tenantId);

    const { data: othersOnly, error: otherErr } = await a.client
      .from('tenants')
      .select('id')
      .eq('id', b.tenantId);
    expect(otherErr).toBeNull();
    expect(othersOnly).toHaveLength(0);
  });

  it("user A cannot insert a whatsapp_instance into B's tenant", async () => {
    const a = state.a!;
    const b = state.b!;

    const { data, error } = await a.client
      .from('whatsapp_instances')
      .insert({
        tenant_id: b.tenantId,
        uazapi_instance_id: `stolen-${suffix}`,
        status: 'disconnected',
      })
      .select()
      .maybeSingle();

    // RLS must reject. Either `error` is set (row violates with_check) or
    // the insert returns zero rows (select after insert filters it out).
    // The canonical Postgres error is 42501 / "new row violates row-level
    // security policy".
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Confirm via service-role that nothing was written into B's tenant.
    const { data: leakage, error: leakErr } = await admin
      .from('whatsapp_instances')
      .select('id')
      .eq('tenant_id', b.tenantId)
      .eq('uazapi_instance_id', `stolen-${suffix}`);
    expect(leakErr).toBeNull();
    expect(leakage).toHaveLength(0);
  });

  it('user A cannot insert directly into tenants (insert policy dropped)', async () => {
    const a = state.a!;

    const { data, error } = await a.client
      .from('tenants')
      .insert({ name: `stolen-tenant-${suffix}` })
      .select()
      .maybeSingle();

    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Double-check via service-role: no tenant with that name.
    const { data: check, error: checkErr } = await admin
      .from('tenants')
      .select('id')
      .eq('name', `stolen-tenant-${suffix}`);
    expect(checkErr).toBeNull();
    expect(check).toHaveLength(0);
  });

  it('user A can insert a group in their own tenant, and cannot see B\'s group', async () => {
    const a = state.a!;
    const b = state.b!;

    // Create whatsapp_instances for both tenants via service-role so both
    // can host groups. Capture ids on the fixture for later assertions.
    const { data: instA, error: instAErr } = await admin
      .from('whatsapp_instances')
      .insert({
        tenant_id: a.tenantId,
        uazapi_instance_id: `inst-a-${suffix}`,
        status: 'disconnected',
      })
      .select('id')
      .single();
    expect(instAErr).toBeNull();
    a.instanceId = instA!.id;

    const { data: instB, error: instBErr } = await admin
      .from('whatsapp_instances')
      .insert({
        tenant_id: b.tenantId,
        uazapi_instance_id: `inst-b-${suffix}`,
        status: 'disconnected',
      })
      .select('id')
      .single();
    expect(instBErr).toBeNull();
    b.instanceId = instB!.id;

    // Seed a group in tenant B via service-role.
    const bGroupJid = `group-b-${suffix}@g.us`;
    const { data: bGroup, error: bGroupErr } = await admin
      .from('groups')
      .insert({
        tenant_id: b.tenantId,
        instance_id: b.instanceId!,
        uazapi_group_jid: bGroupJid,
        name: 'B private group',
      })
      .select('id')
      .single();
    expect(bGroupErr).toBeNull();
    expect(bGroup).toBeTruthy();

    // User A: insert their own group — must succeed.
    const { data: aGroup, error: aGroupErr } = await a.client
      .from('groups')
      .insert({
        tenant_id: a.tenantId,
        instance_id: a.instanceId!,
        uazapi_group_jid: `group-a-${suffix}@g.us`,
        name: 'A own group',
      })
      .select('id, tenant_id')
      .single();
    expect(aGroupErr).toBeNull();
    expect(aGroup).toBeTruthy();
    expect(aGroup!.tenant_id).toBe(a.tenantId);

    // User A: selecting groups must return only their own.
    const { data: listed, error: listErr } = await a.client
      .from('groups')
      .select('id, tenant_id');
    expect(listErr).toBeNull();
    expect(listed).toBeTruthy();
    expect(listed!.length).toBe(1);
    expect(listed![0].tenant_id).toBe(a.tenantId);

    // User A: explicit lookup of B's group returns zero rows.
    const { data: crossLook, error: crossErr } = await a.client
      .from('groups')
      .select('id')
      .eq('id', bGroup!.id);
    expect(crossErr).toBeNull();
    expect(crossLook).toHaveLength(0);
  });

  it("user A cannot insert a group targeting B's tenant_id", async () => {
    const a = state.a!;
    const b = state.b!;

    const { data, error } = await a.client
      .from('groups')
      .insert({
        tenant_id: b.tenantId,
        // Use B's instance_id too — the with_check on tenant_id should
        // still reject regardless of the instance used.
        instance_id: b.instanceId!,
        uazapi_group_jid: `hijack-${suffix}@g.us`,
        name: 'hijack attempt',
      })
      .select()
      .maybeSingle();

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("messages are tenant-scoped: A cannot see B's messages", async () => {
    const a = state.a!;
    const b = state.b!;

    // Find B's group id (seeded in the previous test).
    const { data: bGroups, error: bgErr } = await admin
      .from('groups')
      .select('id')
      .eq('tenant_id', b.tenantId)
      .limit(1);
    expect(bgErr).toBeNull();
    expect(bGroups!.length).toBeGreaterThan(0);
    const bGroupId = bGroups![0].id;

    // Seed a message in B's tenant via service-role.
    const msgUaId = `msg-b-${suffix}`;
    const { error: msgErr } = await admin.from('messages').insert({
      tenant_id: b.tenantId,
      group_id: bGroupId,
      uazapi_message_id: msgUaId,
      type: 'text',
      content: 'secret B message',
      captured_at: new Date().toISOString(),
    });
    expect(msgErr).toBeNull();

    // User A: select messages -> must not include B's message.
    const { data: aMsgs, error: aMsgErr } = await a.client
      .from('messages')
      .select('id, tenant_id, uazapi_message_id');
    expect(aMsgErr).toBeNull();
    expect(aMsgs!.find((m) => m.uazapi_message_id === msgUaId)).toBeUndefined();
    for (const m of aMsgs ?? []) {
      expect(m.tenant_id).toBe(a.tenantId);
    }

    // User A: even explicit lookup by uazapi_message_id returns 0 rows.
    const { data: direct, error: directErr } = await a.client
      .from('messages')
      .select('id')
      .eq('uazapi_message_id', msgUaId);
    expect(directErr).toBeNull();
    expect(direct).toHaveLength(0);
  });

  it("user A cannot update B's tenant row", async () => {
    const a = state.a!;
    const b = state.b!;

    const { data, error } = await a.client
      .from('tenants')
      .update({ name: 'pwned' })
      .eq('id', b.tenantId)
      .select();

    // Update with RLS-blocked target returns no error but 0 rows.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    // Verify B's tenant name is unchanged.
    const { data: bTenant, error: bErr } = await admin
      .from('tenants')
      .select('name')
      .eq('id', b.tenantId)
      .single();
    expect(bErr).toBeNull();
    expect(bTenant!.name).not.toBe('pwned');
  });
});
