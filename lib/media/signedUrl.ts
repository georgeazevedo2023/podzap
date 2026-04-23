/**
 * Short-lived signed URL generator for private Storage buckets. Used by the
 * dashboard / history screen to hand the browser a URL it can GET directly
 * without ever exposing the service-role key.
 *
 * The default bucket is `media` (captured WhatsApp media — Fase 5). Fase 9
 * adds the `audios` bucket for generated TTS output; pass
 * `{ bucket: 'audios' }` to target it.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type SignedUrlBucket = "media" | "audios";

const DEFAULT_BUCKET: SignedUrlBucket = "media";
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export class SignedUrlError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SignedUrlError";
  }
}

export interface GetSignedUrlOptions {
  /** Bucket to sign against. Defaults to `media`. */
  bucket?: SignedUrlBucket;
  /** Lifetime in seconds. Defaults to 3600 (1 hour). */
  expiresInSeconds?: number;
}

/**
 * Create a signed URL for downloading `storagePath`.
 *
 * Back-compat:
 *   - `getSignedUrl(path)` → `media` bucket, 1h expiry (legacy shape).
 *   - `getSignedUrl(path, 600)` → `media` bucket, 10min expiry (legacy shape).
 *   - `getSignedUrl(path, { bucket: 'audios' })` → `audios` bucket, 1h expiry.
 *   - `getSignedUrl(path, { bucket, expiresInSeconds })` → full options form.
 *
 * Default lifetime: 1 hour (long enough for an audio player / image preview,
 * short enough to be safe if leaked).
 */
export async function getSignedUrl(
  storagePath: string,
  optsOrExpires?: number | GetSignedUrlOptions,
): Promise<string> {
  if (!storagePath || !storagePath.trim()) {
    throw new SignedUrlError("empty storagePath");
  }

  const bucket: SignedUrlBucket =
    typeof optsOrExpires === "object" && optsOrExpires?.bucket
      ? optsOrExpires.bucket
      : DEFAULT_BUCKET;

  const expiresInSeconds: number =
    typeof optsOrExpires === "number"
      ? optsOrExpires
      : optsOrExpires?.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    throw new SignedUrlError(`createSignedUrl failed: ${error.message}`, error);
  }
  if (!data?.signedUrl) {
    throw new SignedUrlError("createSignedUrl returned no URL");
  }
  return data.signedUrl;
}
