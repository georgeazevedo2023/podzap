/**
 * Short-lived signed URL generator for media stored in the private `media`
 * bucket. Used by the dashboard / history screen to hand the browser a URL
 * it can GET directly without ever exposing the service-role key.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "media";

export class SignedUrlError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SignedUrlError";
  }
}

/**
 * Create a signed URL for downloading `storagePath` from the `media` bucket.
 * Default lifetime: 1 hour (long enough for an audio player / image preview,
 * short enough to be safe if leaked).
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  if (!storagePath || !storagePath.trim()) {
    throw new SignedUrlError("empty storagePath");
  }
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    throw new SignedUrlError(`createSignedUrl failed: ${error.message}`, error);
  }
  if (!data?.signedUrl) {
    throw new SignedUrlError("createSignedUrl returned no URL");
  }
  return data.signedUrl;
}
