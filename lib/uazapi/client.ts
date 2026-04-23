// Thin HTTP client over the UAZAPI gateway.
//
// Design:
//   - Stateless; one instance is safe to share across requests (no cookies).
//   - Admin token goes into the constructor (server-only). Per-instance
//     endpoints take the instance token as a method arg so callers can fetch
//     it from DB and pass it inline — the client does NOT cache it.
//   - All non-2xx responses are wrapped in UazapiError; callers can branch on
//     `err.status`.
//   - We prefer URLs over base64 for audio (smaller payload). See `sendAudio`.
//
// Endpoints here were verified against the live server at
// `https://wsmart.uazapi.com` on 2026-04-22. Any future change in that API
// must be validated by repeating the probe described in the Fase-2 audit.

import {
  CreateInstanceResponseSchema,
  GroupSchema,
  Instance,
  InstanceSchema,
  InstanceStatus,
  InstanceStatusSchema,
  ListGroupsResponseSchema,
  QrCodeResponse,
  SendMessageResponseSchema,
  UazapiError,
  WebhookConfig,
  WebhookConfigSchema,
  WebhookListSchema,
  type Group,
} from "./types";

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

type HeaderBag = Record<string, string>;

interface RequestOpts {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  headers: HeaderBag;
  body?: unknown;
}

async function doRequest<T = unknown>(
  baseUrl: string,
  opts: RequestOpts,
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, "")}${opts.path}`;

  const init: RequestInit = {
    method: opts.method,
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new UazapiError({
      status: 0,
      code: "NETWORK",
      message: `Network error calling ${opts.method} ${opts.path}: ${(err as Error).message}`,
    });
  }

  const ct = res.headers.get("content-type") ?? "";
  const raw = ct.includes("application/json")
    ? await res.json().catch(() => undefined)
    : await res.text().catch(() => undefined);

  if (!res.ok) {
    // UAZAPI standard error envelope is `{ code, message, data }`. Some older
    // endpoints return `{ error, ... }`. We normalise here.
    const body = raw as
      | { message?: string; error?: string; code?: string | number }
      | string
      | undefined;
    const message =
      (typeof body === "object" && body && (body.message || body.error)) ||
      (typeof body === "string" && body) ||
      res.statusText ||
      "UAZAPI request failed";
    const code =
      (typeof body === "object" && body && body.code != null
        ? String(body.code)
        : undefined);
    throw new UazapiError({
      status: res.status,
      code,
      message,
      body: raw,
    });
  }

  return raw as T;
}

/**
 * UAZAPI's QR payload shape (as returned by `POST /instance/connect`):
 *   {
 *     connected: boolean,
 *     instance: {
 *       id, token, status: "connecting"|"connected"|...,
 *       qrcode: "data:image/png;base64,iVBOR..." | ""   // data-URL including prefix
 *     },
 *     ...
 *   }
 *
 * Older/alternate shapes also seen on peer gateways (kept for resilience):
 *   { qrcode: "..." } | { base64: "..." }
 *
 * We return a data-URL-ready base64 string WITHOUT the `data:` prefix so
 * callers (API routes + UI) can add it consistently once: `data:image/png;base64,<...>`.
 */
function extractQrBase64(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const candidate =
    ((r.instance as Record<string, unknown> | undefined)?.qrcode as string | undefined) ??
    (r.qrcode as string | undefined) ??
    (r.base64 as string | undefined) ??
    (r.qrCodeBase64 as string | undefined);
  if (!candidate) return undefined;
  // Strip data-URL prefix if present so callers can re-add consistently.
  return candidate.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
}

/**
 * UAZAPI's status payload is `{ instance: { status: "..." }, ... }` for the
 * `/instance/status` endpoint. `POST /instance/connect` wraps it the same
 * way. We reduce all of these to our internal enum and fall back to the
 * `loggedIn`/`connected` booleans when the string is absent.
 */
function extractStatus(raw: unknown): InstanceStatus {
  if (!raw || typeof raw !== "object") return "unknown";
  const r = raw as Record<string, unknown>;

  const direct =
    ((r.instance as Record<string, unknown> | undefined)?.status as string | undefined) ??
    (r.status as string | undefined);

  const parsed = InstanceStatusSchema.safeParse(direct);
  if (parsed.success) return parsed.data;

  // Boolean fallbacks (skill docs: `loggedIn`; live API also returns `connected`)
  if (r.loggedIn === true || r.connected === true) return "connected";
  if (r.loggedIn === false || r.connected === false) return "disconnected";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Public client                                                       */
/* ------------------------------------------------------------------ */

export class UazapiClient {
  /**
   * @param baseUrl e.g. "https://wsmart.uazapi.com"
   * @param token   Admin token — used for instance lifecycle calls only.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    if (!baseUrl) throw new Error("UazapiClient: baseUrl is required");
    if (!token) throw new Error("UazapiClient: admin token is required");
  }

  // ── Instance lifecycle ────────────────────────────────────────────

  /**
   * Create a new WhatsApp instance. Returns the server-issued id + per-instance
   * token, which the caller must persist (encrypted).
   *
   * Verified: `POST /instance/init` on wsmart.uazapi.com, 2026-04-22.
   * Auth: `admintoken` header (sent alongside `token: <admin>` for parity
   * with peer gateways — the server accepts both).
   * Response envelope: `{ info, instance: { id, token, status, ... }, name,
   * response: "Instance created successfully", status, token }`.
   */
  async createInstance(name: string): Promise<Instance> {
    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/instance/init",
      headers: this.adminHeaders(),
      body: { name },
    });
    return CreateInstanceResponseSchema.parse(raw);
  }

  /**
   * Look up the current connection status for an instance.
   *
   * Verified: `GET /instance/status`, authenticates with the per-instance
   * `token` header. Response: `{ instance: { status, qrcode, ... }, ... }`.
   */
  async getInstanceStatus(instanceToken: string): Promise<InstanceStatus> {
    const raw = await doRequest(this.baseUrl, {
      method: "GET",
      path: "/instance/status",
      headers: this.instanceHeaders(instanceToken),
    });
    return extractStatus(raw);
  }

  /**
   * Request a fresh QR code. If the instance is already connected, the
   * response comes back without a QR (`qrcode: ""`) — we surface that as
   * an empty string so callers can branch on `status`.
   *
   * Verified: `POST /instance/connect` with empty body, `token` header.
   * Response shape: `{ connected: bool, instance: { qrcode, status, ... }, ... }`
   * where `qrcode` is already a `data:image/png;base64,<...>` URL. We strip
   * the prefix internally so downstream always adds it once.
   *
   * NOTE: the API authenticates this call with the per-instance TOKEN, not
   * id. Callers must look up the token from DB.
   */
  async getQrCode(instanceToken: string): Promise<QrCodeResponse> {
    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/instance/connect",
      headers: this.instanceHeaders(instanceToken),
      body: {},
    });
    return {
      qrCodeBase64: extractQrBase64(raw) ?? "",
      status: extractStatus(raw),
    };
  }

  /**
   * List all instances on this server (admin-only). Useful for reconciliation
   * against our DB.
   *
   * Verified: `GET /instance/all`, admin headers. Response is a raw JSON
   * array of instance objects.
   */
  async listInstances(): Promise<Instance[]> {
    const raw = await doRequest<unknown>(this.baseUrl, {
      method: "GET",
      path: "/instance/all",
      headers: this.adminHeaders(),
    });
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => InstanceSchema.parse(r));
  }

  /**
   * Delete an instance.
   *
   * Verified: `DELETE /instance` with the PER-INSTANCE `token` header
   * (NOT admintoken — the server returns 401 "Invalid token" when admin
   * is passed). Returns:
   *   `{ info: "The device has been successfully disconnected and the
   *      instance has been deleted from the database.",
   *      response: "Instance Deleted" }`
   *
   * Other variants that return 405/401 (documented for posterity):
   *   - `DELETE /instance/<id>` → 405
   *   - `POST /instance/logout`  → 405
   *   - `POST /instance/remove`  → 405
   *   - `POST /instance/disconnect` → only transitions to disconnected
   *     without removing from DB
   *
   * Because the real endpoint is instance-scoped, the admin-token constructor
   * is not enough: callers must pass the instance token.
   */
  async deleteInstance(instanceToken: string): Promise<void> {
    await doRequest(this.baseUrl, {
      method: "DELETE",
      path: "/instance",
      headers: this.instanceHeaders(instanceToken),
    });
  }

  /**
   * Softer delete: cancel an in-flight connection attempt but leave the
   * instance row on the server. Useful if a user bailed on QR scan and we
   * want to keep the row for a retry later.
   *
   * Verified: `POST /instance/disconnect`, `token` header.
   */
  async disconnectInstance(instanceToken: string): Promise<void> {
    await doRequest(this.baseUrl, {
      method: "POST",
      path: "/instance/disconnect",
      headers: this.instanceHeaders(instanceToken),
      body: {},
    });
  }

  // ── Groups ────────────────────────────────────────────────────────

  async listGroups(instanceToken: string): Promise<Group[]> {
    const raw = await doRequest(this.baseUrl, {
      method: "GET",
      path: "/group/list?noparticipants=false",
      headers: this.instanceHeaders(instanceToken),
    });
    return ListGroupsResponseSchema.parse(raw);
  }

  async getGroupInfo(instanceToken: string, groupJid: string): Promise<Group> {
    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/group/info",
      headers: this.instanceHeaders(instanceToken),
      body: { groupjid: groupJid },
    });
    return GroupSchema.parse(raw);
  }

  // ── Messaging ─────────────────────────────────────────────────────

  async sendText(
    instanceToken: string,
    to: string,
    text: string,
  ): Promise<void> {
    if (text.length > 4096) {
      throw new UazapiError({
        status: 422,
        code: "TEXT_TOO_LONG",
        message: `Text exceeds WhatsApp's 4096-char limit (${text.length}).`,
      });
    }
    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/send/text",
      headers: this.instanceHeaders(instanceToken),
      body: { number: to, text },
    });
    SendMessageResponseSchema.parse(raw ?? {});
  }

  /**
   * Send an audio message.
   *   - `audio` can be a Buffer (raw bytes) or a string. A string is treated
   *     as:
   *       * https URL  → passed through to UAZAPI as `file` URL.
   *       * data URL   → stripped to raw base64.
   *       * anything else → assumed to be raw base64 already.
   *   - Defaults to PTT (voice note). Pass `{ kind: "audio" }` via the
   *     higher-level SendAudioRequest type for file-style playback.
   *   - `caption` is accepted for API parity but WhatsApp typically ignores
   *     captions on PTT messages.
   */
  async sendAudio(
    instanceToken: string,
    to: string,
    audio: Buffer | string,
    caption?: string,
  ): Promise<void> {
    const file = toUazapiFile(audio);
    const body: Record<string, unknown> = {
      number: to,
      type: "ptt",
      file,
    };
    if (caption) body.text = caption;

    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/send/media",
      headers: this.instanceHeaders(instanceToken),
      body,
    });
    SendMessageResponseSchema.parse(raw ?? {});
  }

  // ── Webhook config ────────────────────────────────────────────────

  /**
   * List the webhook config(s) registered for this instance.
   *
   * Verified: `GET /webhook` with the per-instance `token` header. Returns
   * an array of `{ id, url, events, enabled, addUrlEvents,
   * addUrlTypesMessages, excludeMessages }`. Note the plural: UAZAPI allows
   * registering multiple webhook URLs per instance, though the common case
   * is a single one.
   *
   * Quirk: `GET /instance/webhook` returns 404; only `/webhook` responds.
   */
  async getWebhookConfig(instanceToken: string): Promise<WebhookConfig[]> {
    const raw = await doRequest(this.baseUrl, {
      method: "GET",
      path: "/webhook",
      headers: this.instanceHeaders(instanceToken),
    });
    return WebhookListSchema.parse(raw ?? []);
  }

  /**
   * Register / upsert a webhook config for this instance.
   *
   * Verified: `POST /webhook` with the per-instance `token` header. Body:
   *   `{ url, events: string[], enabled?: boolean,
   *      addUrlEvents?: boolean, addUrlTypesMessages?: boolean,
   *      excludeMessages?: string[] }`.
   * Response: the updated array of webhook configs (same shape as GET).
   *
   * Known event names observed at /webhook in the probe:
   *   "messages", "connection"
   * The skill doc also mentions "status" and "all" but neither was verified
   * live — downstream code should handle unknown event strings gracefully.
   */
  async setWebhookConfig(
    instanceToken: string,
    config: {
      url: string;
      events: string[];
      enabled?: boolean;
      addUrlEvents?: boolean;
      addUrlTypesMessages?: boolean;
      excludeMessages?: string[];
    },
  ): Promise<WebhookConfig[]> {
    const body = {
      url: config.url,
      events: config.events,
      enabled: config.enabled ?? true,
      addUrlEvents: config.addUrlEvents ?? false,
      addUrlTypesMessages: config.addUrlTypesMessages ?? false,
      excludeMessages: config.excludeMessages ?? [],
    };
    const raw = await doRequest(this.baseUrl, {
      method: "POST",
      path: "/webhook",
      headers: this.instanceHeaders(instanceToken),
      body,
    });
    return WebhookListSchema.parse(raw ?? []);
  }

  // ── Header helpers ────────────────────────────────────────────────

  /**
   * Admin-scope headers: used for `POST /instance/init` and `GET
   * /instance/all`. The server expects `admintoken`; we also include `token`
   * because peer gateways (and some UAZAPI routes) re-check the same value
   * under the `token` header.
   */
  private adminHeaders(): HeaderBag {
    return {
      admintoken: this.token,
      token: this.token,
    };
  }

  /**
   * Per-instance headers: used for every endpoint that acts on a single
   * WhatsApp number (`/instance/status`, `/instance/connect`, `/instance`
   * [DELETE], `/send/*`, `/group/*`, `/webhook`, ...).
   */
  private instanceHeaders(instanceToken: string): HeaderBag {
    if (!instanceToken) {
      throw new UazapiError({
        status: 401,
        code: "MISSING_INSTANCE_TOKEN",
        message: "instanceToken is required for this call",
      });
    }
    return { token: instanceToken };
  }
}

/* ------------------------------------------------------------------ */
/* Module-level helpers                                                */
/* ------------------------------------------------------------------ */

/** Convert a Buffer / string into the string UAZAPI expects in `file`. */
function toUazapiFile(audio: Buffer | string): string {
  if (typeof audio === "string") {
    if (/^https?:\/\//i.test(audio)) return audio;             // URL passthrough
    return audio.replace(/^data:audio\/[a-zA-Z0-9+.-]+;base64,/, "");
  }
  // Node Buffer → base64. `Buffer` is available in Next.js server runtimes;
  // this client is server-only.
  return audio.toString("base64");
}

export { UazapiError };
