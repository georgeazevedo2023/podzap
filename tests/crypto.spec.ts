/**
 * Unit tests for lib/crypto.ts — AES-256-GCM round-trip with random IV.
 *
 * These tests don't touch the real `.env.local`; they seed `ENCRYPTION_KEY`
 * in `beforeAll` with a freshly generated 32-byte base64 key so the suite
 * is fully hermetic.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { randomBytes } from "node:crypto";
import { CryptoError, decrypt, encrypt, safeEqual } from "../lib/crypto";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  // 32 bytes → AES-256. base64-encoded so the env mirrors production format.
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("encrypt / decrypt round-trip", () => {
  it("returns the original plaintext after decrypt(encrypt(x))", () => {
    const samples = [
      "hello world",
      "uazapi_instance_token_c8c627b9-36e4-46da-bc5d-65e88bcdc15c",
      "", // empty string is valid input
      "a".repeat(2048), // long-ish
      "multi\nline\ttext with 🔒 emoji and unicode: café",
      "{\"json\": true, \"nested\": [1, 2, 3]}",
    ];
    for (const plain of samples) {
      const enc = encrypt(plain);
      expect(enc).not.toEqual(plain);
      expect(decrypt(enc)).toEqual(plain);
    }
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plain = "same plaintext, different ivs";
    const a = encrypt(plain);
    const b = encrypt(plain);
    const c = encrypt(plain);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
    // But all three still decrypt back to the same thing.
    expect(decrypt(a)).toEqual(plain);
    expect(decrypt(b)).toEqual(plain);
    expect(decrypt(c)).toEqual(plain);
  });

  it("output uses <iv>.<ct>.<tag> format with valid base64 parts", () => {
    const enc = encrypt("hello");
    const parts = enc.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    // IV decodes to 12 bytes
    expect(Buffer.from(parts[0], "base64").length).toBe(12);
    // GCM tag decodes to 16 bytes
    expect(Buffer.from(parts[2], "base64").length).toBe(16);
  });
});

describe("tampered ciphertexts are rejected", () => {
  it("throws when the ciphertext byte is modified", () => {
    const plain = "sensitive data";
    const enc = encrypt(plain);
    const [iv, ct, tag] = enc.split(".");
    const ctBytes = Buffer.from(ct, "base64");
    // Flip the first bit of the ciphertext.
    ctBytes[0] ^= 0x01;
    const tampered = [iv, ctBytes.toString("base64"), tag].join(".");
    expect(() => decrypt(tampered)).toThrowError(CryptoError);
    try {
      decrypt(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(CryptoError);
      expect((err as CryptoError).code).toBe("DECRYPT_FAILED");
    }
  });

  it("throws when the auth tag is modified", () => {
    const enc = encrypt("x");
    const [iv, ct, tag] = enc.split(".");
    const tagBytes = Buffer.from(tag, "base64");
    tagBytes[0] ^= 0xff;
    const tampered = [iv, ct, tagBytes.toString("base64")].join(".");
    expect(() => decrypt(tampered)).toThrow(CryptoError);
  });

  it("throws on malformed format (wrong part count)", () => {
    expect(() => decrypt("not-a-valid-payload")).toThrowError(CryptoError);
    expect(() => decrypt("a.b")).toThrowError(CryptoError);
    expect(() => decrypt("a.b.c.d")).toThrowError(CryptoError);
  });

  it("throws on empty payload", () => {
    expect(() => decrypt("")).toThrow(CryptoError);
  });

  it("throws when IV length is wrong", () => {
    // Replace IV with 8 bytes instead of 12.
    const enc = encrypt("x");
    const [, ct, tag] = enc.split(".");
    const badIv = Buffer.alloc(8).toString("base64");
    expect(() => decrypt([badIv, ct, tag].join("."))).toThrowError(
      /IV must be 12 bytes/,
    );
  });
});

describe("key handling", () => {
  it("throws when ENCRYPTION_KEY is missing", () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encrypt("x")).toThrowError(/ENCRYPTION_KEY env var/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it("throws when ENCRYPTION_KEY has wrong byte length", () => {
    const saved = process.env.ENCRYPTION_KEY;
    // 16 bytes → AES-128, not what we want
    process.env.ENCRYPTION_KEY = randomBytes(16).toString("base64");
    try {
      expect(() => encrypt("x")).toThrowError(/must decode to 32 bytes/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });
  it("returns false for different lengths without throwing", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
