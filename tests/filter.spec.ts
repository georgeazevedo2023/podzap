/**
 * Tests for lib/pipeline/filter.ts — relevance filter + weighting.
 *
 * Pure unit tests; no fixtures, no DB. Each test builds a minimal
 * `FilterInput` row and asserts on the returned `FilterResult`.
 */
import { describe, expect, it } from "vitest";
import {
  filterMessages,
  type FilterInput,
} from "../lib/pipeline/filter";

/**
 * Factory for a "baseline" text row — tests override only the fields they
 * care about so the intent of each case stays readable.
 */
function row(overrides: Partial<FilterInput[number]> = {}): FilterInput[number] {
  return {
    id: "msg-1",
    senderName: "Alice",
    senderJid: "alice@s.whatsapp.net",
    capturedAt: new Date("2026-04-22T12:00:00Z"),
    type: "text",
    content: "This is a reasonably sized message.",
    mediaUrl: null,
    mediaDurationSeconds: null,
    transcriptText: null,
    ...overrides,
  };
}

describe("filterMessages — basic plumbing", () => {
  it("returns empty kept + 0 discarded for empty input", () => {
    const result = filterMessages([]);
    expect(result.kept).toEqual([]);
    expect(result.discarded).toBe(0);
  });
});

describe("filterMessages — drop rules", () => {
  it("drops 'ok' as a stopword", () => {
    const result = filterMessages([row({ content: "ok" })]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("drops 'kkkk' as a stopword (case-insensitive)", () => {
    const result = filterMessages([row({ content: "KKKK" })]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("drops short text ('hi') with no media attached", () => {
    const result = filterMessages([row({ content: "hi" })]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("drops URL-only messages", () => {
    const result = filterMessages([
      row({ content: "https://example.com/some/path" }),
    ]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("drops emoji-only messages", () => {
    const result = filterMessages([row({ content: "🎉🎉🎉" })]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("drops stickers (type='other' with 'sticker' in content)", () => {
    const result = filterMessages([
      row({ type: "other", content: "[sticker]", mediaUrl: "https://x/y" }),
    ]);
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });
});

describe("filterMessages — weight computation", () => {
  it("keeps a long text with weight above base (0.3)", () => {
    const longText = "a".repeat(150);
    const result = filterMessages([row({ content: longText })]);
    expect(result.kept).toHaveLength(1);
    const msg = result.kept[0];
    if (!msg) throw new Error("expected kept[0]");
    // base 0.3 + >100 chars 0.15 = 0.45
    expect(msg.weight).toBeGreaterThan(0.3);
    expect(msg.weight).toBeCloseTo(0.45, 5);
  });

  it("boosts audio messages with duration > 20s", () => {
    const shortAudio = filterMessages([
      row({
        id: "short",
        type: "audio",
        content: null,
        transcriptText: "This is a short audio transcript.",
        mediaUrl: "https://x/a.ogg",
        mediaDurationSeconds: 5,
      }),
    ]);
    const longAudio = filterMessages([
      row({
        id: "long",
        type: "audio",
        content: null,
        transcriptText: "This is a long audio transcript.",
        mediaUrl: "https://x/a.ogg",
        mediaDurationSeconds: 45,
      }),
    ]);
    const s = shortAudio.kept[0];
    const l = longAudio.kept[0];
    if (!s || !l) throw new Error("expected both audios to be kept");
    expect(l.weight).toBeGreaterThan(s.weight);
    expect(l.weight - s.weight).toBeCloseTo(0.3, 5);
  });

  it("boosts questions (ends with '?')", () => {
    const plain = filterMessages([row({ content: "We should ship today" })]);
    const question = filterMessages([row({ content: "Should we ship today?" })]);
    const p = plain.kept[0];
    const q = question.kept[0];
    if (!p || !q) throw new Error("expected both rows to be kept");
    expect(q.weight - p.weight).toBeCloseTo(0.15, 5);
  });

  it("boosts messages containing a keyword", () => {
    const plain = filterMessages([row({ content: "We chatted about stuff" })]);
    const keyword = filterMessages([
      row({ content: "Reunião marcada para amanhã" }),
    ]);
    const p = plain.kept[0];
    const k = keyword.kept[0];
    if (!p || !k) throw new Error("expected both rows to be kept");
    expect(k.weight - p.weight).toBeCloseTo(0.3, 5);
  });

  it("caps combined boosts at 1.0", () => {
    // base 0.3 + audio>20s 0.3 + >100 chars 0.15 + question 0.15 + keyword 0.3 = 1.20 → clamp to 1.0
    const mega = "a".repeat(120) + " decisão urgente sobre o prazo?";
    const result = filterMessages([
      row({
        type: "audio",
        content: null,
        transcriptText: mega,
        mediaUrl: "https://x/a.ogg",
        mediaDurationSeconds: 60,
      }),
    ]);
    const m = result.kept[0];
    if (!m) throw new Error("expected mega row to be kept");
    expect(m.weight).toBe(1);
  });

  it("uses transcriptText when content is null", () => {
    const result = filterMessages([
      row({
        type: "audio",
        content: null,
        transcriptText: "Conteúdo transcrito do áudio",
        mediaUrl: "https://x/a.ogg",
        mediaDurationSeconds: 15,
      }),
    ]);
    const m = result.kept[0];
    if (!m) throw new Error("expected audio row to be kept");
    expect(m.content).toBe("Conteúdo transcrito do áudio");
  });
});

describe("filterMessages — minWeight option", () => {
  it("filters out kept items whose weight falls below minWeight", () => {
    const input: FilterInput = [
      // plain short-ish text → base weight 0.3 (below 0.5)
      row({ id: "low", content: "Bom dia pessoal do grupo" }),
      // long text with keyword → 0.3 + 0.15 + 0.3 = 0.75 (above 0.5)
      row({
        id: "high",
        content:
          "Pessoal, temos uma decisão importante sobre o projeto que precisa ser tomada ainda hoje à tarde para não travar o time.",
      }),
    ];

    const all = filterMessages(input);
    expect(all.kept).toHaveLength(2);

    const picky = filterMessages(input, { minWeight: 0.5 });
    expect(picky.kept).toHaveLength(1);
    const kept = picky.kept[0];
    if (!kept) throw new Error("expected high-weight row to survive");
    expect(kept.id).toBe("high");
    expect(picky.discarded).toBe(1);
  });
});
