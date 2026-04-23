# Groups Sync

How podZAP pulls WhatsApp groups from UAZAPI into the `groups` table so the
user can toggle which ones feed the summarisation pipeline.

- **Service**: `lib/groups/service.ts`
- **UAZAPI endpoint used**: `GET /group/list?noparticipants=false` (see
  `docs/integrations/uazapi.md` §2.2)
- **Tables touched**: `groups`, `whatsapp_instances` (read-only)

---

## 1. Overview

Groups sync is a pull-only operation triggered by the user (from the `/groups`
screen) or, later, by a scheduled job. It:

1. Loads the tenant's `whatsapp_instances` row.
2. Decrypts the per-instance UAZAPI token (AES-256-GCM with `ENCRYPTION_KEY`).
3. Calls `UazapiClient.listGroups(instanceToken)`.
4. **Upserts** each returned group by the unique key
   `(tenant_id, uazapi_group_jid)` — so re-syncs update name / picture /
   member-count without creating duplicates.
5. Updates `last_synced_at` on every row it touched.
6. Returns a `{ count }` envelope so the UI can show "Synced N groups".

Importantly, `is_monitored` is **preserved** across re-syncs. The upsert
statement only writes the metadata columns (`name`, `picture_url`,
`members_count`, `last_synced_at`); the monitor flag is under user control
and is never clobbered by a remote sync.

Deletes are **not** propagated. A group removed on WhatsApp simply stops
showing up in subsequent `listGroups` responses; the row stays behind with
its last-known `last_synced_at`. See §3 (Edge cases) for the planned
stale-marker follow-up.

---

## 2. Flow

ASCII sequence for `POST /api/groups/sync`:

```
Browser               Next.js API route            groups/service.ts        UazapiClient              UAZAPI
  |                         |                            |                       |                       |
  | click "sincronizar"     |                            |                       |                       |
  |------------------------>|                            |                       |                       |
  |                         | auth -> resolve tenantId   |                       |                       |
  |                         | rate-limit check (6/min/tenant)                    |                       |
  |                         |--------------------------->|                       |                       |
  |                         |                            | SELECT * FROM         |                       |
  |                         |                            | whatsapp_instances    |                       |
  |                         |                            | WHERE tenant_id = ... |                       |
  |                         |                            | (404 -> 409 NO_INSTANCE)                      |
  |                         |                            |                       |                       |
  |                         |                            | decrypt(uazapi_token_encrypted)               |
  |                         |                            |---------------------->|                       |
  |                         |                            |                       | GET /group/list       |
  |                         |                            |                       |  Header: token=<INST> |
  |                         |                            |                       |---------------------->|
  |                         |                            |                       |<-- Group[] (may be    |
  |                         |                            |                       |    wrapped in         |
  |                         |                            |                       |    {groups:[...]} or  |
  |                         |                            |                       |    {data:[...]})      |
  |                         |                            |<-- normalised Group[] |                       |
  |                         |                            |                       |                       |
  |                         |                            | UPSERT groups         |                       |
  |                         |                            |   ON CONFLICT         |                       |
  |                         |                            |   (tenant_id,         |                       |
  |                         |                            |    uazapi_group_jid)  |                       |
  |                         |                            |   DO UPDATE SET       |                       |
  |                         |                            |     name, picture_url,|                       |
  |                         |                            |     members_count,    |                       |
  |                         |                            |     last_synced_at    |                       |
  |                         |                            |   -- is_monitored     |                       |
  |                         |                            |   -- intentionally    |                       |
  |                         |                            |   -- NOT touched      |                       |
  |                         |<-- { count: N } -----------|                       |                       |
  |<-- 200 { count: N } ----|                            |                       |                       |
```

---

## 3. Edge cases

| Scenario | Behaviour |
|---|---|
| Tenant has no `whatsapp_instances` row | Service throws `NO_INSTANCE`; route responds `409 { code: "NO_INSTANCE" }`. UI nudges the user to `/onboarding`. |
| Instance exists but status is `connecting` or `disconnected` | Sync is still attempted. UAZAPI responds with an empty array (no WhatsApp socket -> no groups), so zero rows are upserted. Route returns `200 { count: 0 }`; UI shows "0 grupos" + a hint to finish pairing. |
| Instance token expired / revoked (`401` from UAZAPI) | Service surfaces the HTTP error; route maps to `502 { code: "UAZAPI_ERROR" }`. Fase 4 webhook on `connection.update` will flip the instance `status` back to `disconnected` so the UI self-heals. |
| Group deleted on WhatsApp | Not handled in Fase 3. The row stays in `groups` with the old `last_synced_at`. **Pós-MVP:** mark rows whose `last_synced_at` is older than the last full sync as stale (e.g., `stale_since`), hide them in the UI, and auto-untoggle `is_monitored` after N consecutive stale syncs. |
| User spam-clicks "sincronizar" | In-memory rate limit **6 syncs / min / tenant** at the route layer (same pattern as Fase 2). Excess returns `429 { code: "RATE_LIMITED" }`. |
| UAZAPI returns > ~500 groups | Current `listGroups` is unpaginated (see §5). For now, the upsert is done in a single statement; if this becomes a problem, chunk in 100-row batches. |
| Concurrent syncs from two tabs | Upsert is idempotent — last writer wins on metadata columns, `is_monitored` is untouched. No locking needed. |

---

## 4. Data model

The `groups` table (see `db/migrations/`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `tenant_id` | `uuid` FK | RLS scope |
| `uazapi_group_jid` | `text` | e.g. `120363012345678@g.us`. **Unique with `tenant_id`**. |
| `name` | `text` | Updated on every sync. |
| `picture_url` | `text` nullable | Updated on every sync (see §5 — TODO backfill). |
| `members_count` | `int` nullable | Updated on every sync. |
| `is_monitored` | `boolean` default `false` | **Preserved on re-sync.** Only the user can toggle it via `POST /api/groups/[id]/monitor`. |
| `last_synced_at` | `timestamptz` | Touched by every sync. |
| `created_at` | `timestamptz` default `now()` | |

RLS: every query filters by `tenant_id = auth.tenant_id()` (as elsewhere in
the project).

---

## 5. API

All responses use the standard error envelope
`{ ok: false, error: { code, message } }` on failure; success shapes are per
route.

| Method + Path | Auth | Request | Success response | Notes |
|---|---|---|---|---|
| `POST /api/groups/sync` | Session | (none) | `200 { ok: true, count: number }` | Rate limit 6/min/tenant. `409 NO_INSTANCE` if tenant has no instance. `502 UAZAPI_ERROR` if upstream fails. |
| `GET /api/groups` | Session | Query: `?monitored=true` (optional) | `200 { ok: true, groups: Group[] }` | Client-side refresh after toggle/sync. |
| `POST /api/groups/[id]/monitor` | Session | `{ monitored: boolean }` | `200 { ok: true, group: Group }` | Tenant-check enforced in the update `WHERE` clause on top of RLS (defence in depth). Returns `404 NOT_FOUND` if the id doesn't belong to the tenant. |

`Group` DTO returned by the API:

```ts
{
  id: string;
  uazapiGroupJid: string;
  name: string;
  pictureUrl: string | null;
  membersCount: number | null;
  isMonitored: boolean;
  lastSyncedAt: string; // ISO
}
```

> **TODO (sync with implementation agents):** the plan lists the route as
> `/api/groups/:id/monitor`; if the implementation ships a different final
> shape (e.g. `PATCH /api/groups/[id]`), update this table accordingly.

---

## 6. Future / pós-MVP

- **Pagination of `listGroups`** — the UAZAPI docs don't commit to a
  page-size cap, but the skill warns that instances with hundreds of groups
  may paginate in v2. When it does, add a cursor loop in
  `UazapiClient.listGroups` and continue upserting in batches.
- **Backfill `picture_url`** — `GET /group/list` often returns pictures as
  expirable CDN URLs. Option A: persist as-is and refresh on every sync
  (current plan). Option B: download once and store in Supabase Storage so
  the UI doesn't break when the CDN URL expires.
- **Group archive / stale marker** — see §3. Mark rows unseen in the last N
  syncs as stale, hide from main list, and expose an "archived" tab for
  undo.
- **Webhook-driven sync** — Fase 4 will expose `group.upsert` /
  `group.remove` events on the `/api/webhooks/uazapi` route; at that point
  the manual "sincronizar" button becomes a fallback for reconciliation,
  not the primary path.
