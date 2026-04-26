/**
 * Media downloader + Supabase Storage integration (Fase 4, Agente 4).
 *
 * Responsibilities:
 *   1. Fetch a media URL from UAZAPI (or any HTTPS source) with SSRF guards,
 *      timeouts, and size caps.
 *   2. Sniff the MIME via magic bytes (fallback: Content-Type / hinted /
 *      octet-stream).
 *   3. Upload the bytes to the private `media` bucket under the convention
 *      `<tenant_id>/<yyyy>/<mm>/<message_id>.<ext>`.
 *   4. Persist the resulting path + mime + size on the `messages` row and set
 *      `media_download_status` to `'downloaded'`.
 *
 * This is a BEST-EFFORT job. On any failure we set the row's status to
 * `'failed'` with an error string in logs, but we NEVER throw — the caller
 * (webhook handler) must keep serving subsequent events.
 *
 * Not yet plumbed: hostname DNS resolution to catch a malicious redirect
 * or CNAME pointing to a private IP. For UAZAPI-supplied URLs (trusted
 * gateway) the literal-IP + scheme guards here suffice; if we later accept
 * media URLs from untrusted sources this should grow a `dns.lookup` pre-check.
 */
import { isIP } from "node:net";

import { createAdminClient } from "@/lib/supabase/admin";

export type DownloadResult = {
  status: "downloaded" | "failed" | "skipped";
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
};

export type DownloadOpts = {
  /** Default: 50 MiB. WhatsApp caps media at ~16 MiB for audio / 100 MiB
   *  for video; 50 MiB is the sweet spot for the podZAP use case (audio
   *  first, images second). */
  maxSizeBytes?: number;
  /** Default: 30 s. UAZAPI media CDNs usually answer in <1 s; this is our
   *  backstop against hung connections. */
  timeoutMs?: number;
  /** MIME reported by UAZAPI in the payload; used only if magic-byte sniff
   *  fails to recognise the format. */
  hintedMime?: string;
  /**
   * UAZAPI context for resolving encrypted WhatsApp media URLs
   * (`mmg.whatsapp.net/...enc`) into plain HTTPS URLs we can fetch.
   * Optional — when omitted, encrypted URLs will fail at the AES decrypt
   * step (we don't have mediaKey here). When provided, the downloader
   * detects encrypted URLs and calls `client.downloadMedia` first.
   */
  uazapiResolve?: {
    instanceToken: string;
    whatsappMessageId: string;
  };
};

/** True for `https://mmg.whatsapp.net/.../*.enc` style URLs. */
function isEncryptedWhatsAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("whatsapp.net")) return false;
    return u.pathname.endsWith(".enc");
  } catch {
    return false;
  }
}

const BUCKET = "media";
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

// ──────────────────────────────────────────────────────────────────────────
//  SSRF guards
// ──────────────────────────────────────────────────────────────────────────

/**
 * Reject literal IP hostnames that fall into private / link-local / loopback
 * ranges. Does NOT resolve DNS — see module header for the rationale.
 */
function isPrivateOrLoopbackIp(host: string): boolean {
  const v = isIP(host);
  if (v === 0) return false; // not a literal IP — can't decide here
  if (v === 6) {
    // IPv6: loopback ::1, unspecified ::, link-local fe80::/10, ULA fc00::/7,
    // IPv4-mapped (::ffff:127.0.0.1) all look suspicious in a webhook context.
    const low = host.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true;
    if (low.startsWith("::ffff:")) {
      // v4-mapped — re-check the v4 tail.
      return isPrivateOrLoopbackIp(low.slice("::ffff:".length));
    }
    return false;
  }
  // IPv4
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true;               // loopback 127.0.0.0/8
  if (a === 10) return true;                // private 10.0.0.0/8
  if (a === 0) return true;                 // 0.0.0.0/8 unspecified
  if (a === 169 && b === 254) return true;  // link-local 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;  // 192.168/16
  return false;
}

/**
 * Strict URL policy. Returns the parsed URL when safe, or a reason string
 * otherwise. We allow `http:` only in non-production because local dev
 * sometimes proxies UAZAPI media through `http://ngrok-domain` — callers on
 * the hot path should still prefer https.
 */
function validateSourceUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `invalid URL: ${raw}` };
  }
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme !== "https" && !(scheme === "http" && process.env.NODE_ENV !== "production")) {
    return { error: `disallowed URL scheme: ${scheme}` };
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") {
    return { error: `localhost host rejected: ${host}` };
  }
  if (isPrivateOrLoopbackIp(host)) {
    return { error: `private/loopback host rejected: ${host}` };
  }
  return { url };
}

// ──────────────────────────────────────────────────────────────────────────
//  MIME sniffer
// ──────────────────────────────────────────────────────────────────────────

/**
 * Magic-byte sniff for the formats we care about (audio + image on the
 * WhatsApp side, mp4 video as a stretch goal). Inspects the first 12 bytes
 * of a buffer. Returns `null` if nothing matches — caller will then fall
 * back to the transport Content-Type or the UAZAPI hint.
 *
 * Recognised:
 *   - image/png (89 50 4E 47 ...)
 *   - image/jpeg (FF D8 FF ..)
 *   - image/gif (GIF87a / GIF89a)
 *   - image/webp (RIFF ???? WEBP)
 *   - audio/ogg (OggS)
 *   - audio/mpeg (ID3 / FF Fx MPEG sync)
 *   - video/mp4 (ftyp at offset 4)
 *   - audio/mp4 (M4A / AAC in ftyp)
 */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const b = buf;

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF87a / GIF89a
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
    b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // OGG (Vorbis/Opus): "OggS"
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "audio/ogg";
  // MP3: "ID3" tag
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio/mpeg";
  // MP3: raw MPEG frame sync 0xFF 0xFB/0xF3/0xF2 etc.
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // MP4 family: "ftyp" at offset 4
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) {
    // Brand sub-type decides audio vs video. "M4A " / "mp42" / "isom" ...
    const brand = b.slice(8, 12).toString("ascii");
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return "audio/mp4";
    return "video/mp4";
  }
  return null;
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "audio/ogg": return "ogg";
    case "audio/mpeg": return "mp3";
    case "audio/mp4": return "m4a";
    case "video/mp4": return "mp4";
    case "application/octet-stream": return "bin";
    default: {
      // Best-effort: image/foo → foo, audio/x-bar → bar.
      const m = /^[^/]+\/(.+)$/.exec(mime);
      if (m) return m[1].replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
      return "bin";
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

function storagePathFor(tenantId: string, messageId: string, ext: string, now = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${tenantId}/${yyyy}/${mm}/${messageId}.${ext}`;
}

/** Pull a stream into a Buffer, bailing early if we blow past `maxBytes`. */
async function drainWithCap(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ buf: Buffer } | { tooLarge: true; receivedBytes: number }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return { tooLarge: true, receivedBytes: received };
      }
      chunks.push(value);
    }
  }
  return { buf: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
}

async function markFailed(
  tenantId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("messages")
      .update({ media_download_status: "failed" })
      .eq("id", messageId)
      .eq("tenant_id", tenantId);
  } catch (err) {
    // Swallow — this is already the failure path.
    console.error("[media/download] markFailed also failed", { messageId, reason, err });
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

export async function downloadAndStore(
  tenantId: string,
  messageId: string,
  sourceUrl: string,
  opts?: DownloadOpts,
): Promise<DownloadResult> {
  const maxSize = opts?.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!sourceUrl || !sourceUrl.trim()) {
    // Intentionally NOT marked failed — no URL ≠ broken download, just "nothing
    // to do". Callers that still want a status in DB can pass a sentinel URL.
    return { status: "skipped", error: "empty sourceUrl" };
  }

  // Encrypted WhatsApp URLs need UAZAPI to decrypt first. When we have the
  // context, resolve to the plain CDN URL before continuing.
  let resolvedUrl = sourceUrl;
  let resolvedMime: string | undefined = opts?.hintedMime;
  if (isEncryptedWhatsAppUrl(sourceUrl)) {
    if (!opts?.uazapiResolve) {
      const reason =
        "encrypted WhatsApp URL (.enc) but no uazapiResolve opts — caller must pass instanceToken + whatsappMessageId";
      await markFailed(tenantId, messageId, reason);
      return { status: "failed", error: reason };
    }
    try {
      const { UazapiClient } = await import("@/lib/uazapi/client");
      const baseUrl = process.env.UAZAPI_BASE_URL ?? "";
      const adminToken = process.env.UAZAPI_ADMIN_TOKEN ?? "";
      if (!baseUrl || !adminToken) {
        throw new Error(
          "UAZAPI_BASE_URL or UAZAPI_ADMIN_TOKEN missing in env — cannot resolve encrypted URL",
        );
      }
      // adminToken só satisfaz o constructor; o método usa instanceToken
      // que vem por argumento.
      const client = new UazapiClient(baseUrl, adminToken);
      const resolved = await client.downloadMedia(
        opts.uazapiResolve.instanceToken,
        opts.uazapiResolve.whatsappMessageId,
      );
      resolvedUrl = resolved.fileURL;
      if (resolved.mimetype) resolvedMime = resolved.mimetype;
    } catch (err) {
      const reason = `uazapi downloadMedia failed: ${err instanceof Error ? err.message : String(err)}`;
      await markFailed(tenantId, messageId, reason);
      return { status: "failed", error: reason };
    }
  }

  const parsed = validateSourceUrl(resolvedUrl);
  if ("error" in parsed) {
    await markFailed(tenantId, messageId, parsed.error);
    return { status: "failed", error: parsed.error };
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(parsed.url, { signal: controller.signal, redirect: "follow" });
  } catch (err) {
    clearTimeout(abortTimer);
    const isAbort = err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message));
    const reason = isAbort
      ? `fetch timed out after ${timeoutMs}ms`
      : `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    await markFailed(tenantId, messageId, reason);
    return { status: "failed", error: reason };
  }
  clearTimeout(abortTimer);

  if (!response.ok) {
    const reason = `upstream ${response.status} ${response.statusText}`.trim();
    await markFailed(tenantId, messageId, reason);
    return { status: "failed", error: reason };
  }

  // Early bail on Content-Length.
  const cl = response.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxSize) {
      const reason = `content-length ${n} exceeds max ${maxSize}`;
      await markFailed(tenantId, messageId, reason);
      return { status: "failed", error: reason };
    }
  }

  let buffer: Buffer;
  if (response.body) {
    const drained = await drainWithCap(response.body, maxSize);
    if ("tooLarge" in drained) {
      const reason = `body exceeded max size ${maxSize} bytes (received ≥ ${drained.receivedBytes})`;
      await markFailed(tenantId, messageId, reason);
      return { status: "failed", error: reason };
    }
    buffer = drained.buf;
  } else {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxSize) {
      const reason = `body ${ab.byteLength} exceeds max ${maxSize}`;
      await markFailed(tenantId, messageId, reason);
      return { status: "failed", error: reason };
    }
    buffer = Buffer.from(ab);
  }

  const sniffed = sniffMimeType(buffer);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const mime = sniffed ?? (contentType && contentType.length > 0 ? contentType : undefined) ?? resolvedMime ?? "application/octet-stream";
  const ext = mimeToExtension(mime);
  const path = storagePathFor(tenantId, messageId, ext);

  const admin = createAdminClient();
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadErr) {
    const reason = `storage upload failed: ${uploadErr.message}`;
    await markFailed(tenantId, messageId, reason);
    return { status: "failed", error: reason };
  }

  const { error: updateErr } = await admin
    .from("messages")
    .update({
      media_storage_path: path,
      media_mime_type: mime,
      media_size_bytes: buffer.byteLength,
      media_download_status: "downloaded",
    })
    .eq("id", messageId)
    .eq("tenant_id", tenantId);
  if (updateErr) {
    const reason = `db update failed: ${updateErr.message}`;
    await markFailed(tenantId, messageId, reason);
    return { status: "failed", error: reason };
  }

  return {
    status: "downloaded",
    storagePath: path,
    mimeType: mime,
    sizeBytes: buffer.byteLength,
  };
}
