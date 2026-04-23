/**
 * Symmetric encryption helpers for at-rest secrets (e.g. UAZAPI per-instance
 * tokens stored in Postgres).
 *
 * Algorithm: AES-256-GCM
 *   - Key: 32 raw bytes, decoded from `ENCRYPTION_KEY` env (base64).
 *   - IV:  12 random bytes per encrypt call.
 *   - Auth tag: 16 bytes.
 *
 * Output format (pure ASCII, safe for any Postgres text column):
 *
 *     <iv_b64>.<ciphertext_b64>.<tag_b64>
 *
 * `decrypt` parses the three parts, verifies the GCM tag, and throws a typed
 * error on any malformed input or tampered byte. All errors are instances of
 * `CryptoError` so callers can distinguish user-facing problems (bad env key)
 * from actual tampering.
 *
 * NOTE: this module is **server-only**. `ENCRYPTION_KEY` must never be
 * bundled into a client component.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SEPARATOR = ".";

/** All crypto failures raise this so callers can switch on `code`. */
export class CryptoError extends Error {
  readonly code:
    | "MISSING_KEY"
    | "INVALID_KEY"
    | "INVALID_FORMAT"
    | "INVALID_IV"
    | "INVALID_TAG"
    | "DECRYPT_FAILED";

  constructor(code: CryptoError["code"], message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

/** Lazily resolve the raw key bytes so test setups can mutate env before use. */
function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    throw new CryptoError(
      "MISSING_KEY",
      "ENCRYPTION_KEY env var is not set. Required for lib/crypto.ts.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new CryptoError("INVALID_KEY", "ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      "INVALID_KEY",
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (AES-256); got ${key.length}.`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new CryptoError("INVALID_FORMAT", "encrypt() requires a string.");
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(SEPARATOR);
}

export function decrypt(payload: string): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new CryptoError(
      "INVALID_FORMAT",
      "decrypt() requires a non-empty string.",
    );
  }
  const parts = payload.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new CryptoError(
      "INVALID_FORMAT",
      `Expected "<iv>.<ciphertext>.<tag>" (3 parts); got ${parts.length}.`,
    );
  }
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  if (iv.length !== IV_BYTES) {
    throw new CryptoError(
      "INVALID_IV",
      `IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
    );
  }
  if (tag.length !== TAG_BYTES) {
    throw new CryptoError(
      "INVALID_TAG",
      `GCM tag must be ${TAG_BYTES} bytes; got ${tag.length}.`,
    );
  }

  const key = loadKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  try {
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch (err) {
    // Node throws a generic "Unsupported state or unable to authenticate data"
    // when the tag verification fails. Normalise for callers.
    throw new CryptoError(
      "DECRYPT_FAILED",
      `Decryption failed (tampered ciphertext or wrong key): ${(err as Error).message}`,
    );
  }
}

/**
 * Constant-time string compare for paranoia use (e.g. webhook secret
 * comparison). Not strictly needed by encrypt/decrypt but exported here so
 * all cryptographic primitives live in one module.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
