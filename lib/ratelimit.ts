/**
 * Minimal in-memory rate limiter.
 *
 * Design:
 *   - Single `Map<string, { count, resetAt }>` per process.
 *   - Fixed-window algorithm (not sliding) — good enough for the kind of
 *     abuse this guards against (polling loops gone wild).
 *   - Keys are caller-supplied, usually `${tenantId}:${routeName}`.
 *
 * TODO (production): replace with Redis / Upstash before horizontal scale.
 * This module's state is per-Node-process and dies on redeploy — serverless
 * environments with cold starts will see the window reset unexpectedly. The
 * exported shape stays the same, so only the implementation changes.
 */

type Bucket = { count: number; resetAt: number };

const buckets: Map<string, Bucket> = new Map();

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs?: number;
  /** Remaining requests in the current window. Useful for `X-RateLimit-*` headers. */
  remaining?: number;
  /** When the current window ends (epoch ms). */
  resetAt?: number;
}

/**
 * Check and increment a rate-limit bucket.
 *
 * Returns `{ ok: true }` if the request is allowed (and records it).
 * Returns `{ ok: false, retryAfterMs }` if the window is exhausted.
 *
 * @param key            Opaque string identifying the bucket (e.g. `tenant:id:qrcode`).
 * @param maxPerWindow   Max requests allowed in one window.
 * @param windowMs       Window length in milliseconds.
 */
export function checkRateLimit(
  key: string,
  maxPerWindow: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: maxPerWindow - 1, resetAt };
  }

  if (existing.count >= maxPerWindow) {
    return {
      ok: false,
      retryAfterMs: Math.max(0, existing.resetAt - now),
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: maxPerWindow - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Test-only helper to wipe all buckets (unit tests should reset between cases). */
export function _resetRateLimits(): void {
  buckets.clear();
}
