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
//   - NO real HTTP calls have been tested from this file — endpoint paths for
//     createInstance / deleteInstance are marked in docs/integrations/uazapi.md
//     as OPEN QUESTIONS. Verify on first use.

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
  type Group,
} from "./types";

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

type HeaderBag = Record<string, string>;

interface RequestOpts {
  method: "GET" | "POST" | "DELETE";
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
    const body = raw as { message?: string; error?: string; code?: string } | string | undefined;
    const message =
      (typeof body === "object" && body && (body.message || body.error)) ||
      (typeof body === "string" && body) ||
      res.statusText ||
      "UAZAPI request failed";
    throw new UazapiError({
      status: res.status,
      code: (typeof body === "object" && body && body.code) || undefined,
      message,
      body: raw,
    });
  }

  return raw as T;
}

/**
 * UAZAPI sometimes returns a QR code as raw base64, sometimes as a data URL,
 * sometimes inside `{ qrcode }`, `{ base64 }`, or `{ instance: { qrcode } }`.
 * Normalise to a data-URL-ready base64 string (no `data:` prefix).
 */
function extractQrBase64(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const candidate =
    (r.qrcode as string | undefined) ??
    (r.base64 as string | undefined) ??
    (r.qrCodeBase64 as string | undefined) ??
    ((r.instance as Record<string, unknown> | undefined)?.qrcode as string | undefined);
  if (!candidate) return undefined;
  // Strip data-URL prefix if present so callers can re-add consistently.
  return candidate.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
}

/** UAZAPI's status payload has several shapes — reduce to our enum. */
function extractStatus(raw: unknown): InstanceStatus {
  if (!raw || typeof raw !== "object") return "unknown";
  const r = raw as Record<string, unknown>;

  const direct =
    (r.status as string | undefined) ??
    ((r.instance as Record<string, unknown> | undefined)?.status as string | undefined);

  const parsed = InstanceStatusSchema.safeParse(direct);
  if (parsed.success) return parsed.data;

  // loggedIn boolean fallback
  if (r.loggedIn === true) return "connected";
  if (r.loggedIn === false) return "disconnected";
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
   * OPEN QUESTION: exact path is unconfirmed. Trying `/instance/init` first.
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
   * Uses the per-instance token.
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
   * response may come back without a QR — we surface that as an empty string
   * so callers can branch on `status`.
   *
   * NOTE: signature in the task brief uses `instanceId` as the arg but UAZAPI
   * authenticates this endpoint with the per-instance TOKEN, not id. We
   * accept the token here and encourage callers to look it up from DB.
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
   * Delete an instance by id (admin-only).
   *
   * OPEN QUESTION: path unconfirmed. Using `DELETE /instance/{id}` —
   * fall back to `POST /instance/logout` if the server 404s.
   */
  async deleteInstance(instanceId: string): Promise<void> {
    await doRequest(this.baseUrl, {
      method: "DELETE",
      path: `/instance/${encodeURIComponent(instanceId)}`,
      headers: this.adminHeaders(),
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

  // ── Header helpers ────────────────────────────────────────────────

  private adminHeaders(): HeaderBag {
    return {
      admintoken: this.token,
      token: this.token, // skill notes both headers are expected for admin calls
    };
  }

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
