/**
 * Unit tests for lib/pipeline/cluster.ts — topic clustering by time +
 * participant overlap. Pure function, no fixtures needed.
 */
import { describe, expect, it } from "vitest";
import { clusterByTopic } from "../lib/pipeline/cluster";
import type { NormalizedMessage } from "../lib/pipeline/filter";

/** Helper: build a NormalizedMessage with sane defaults. */
function msg(
  partial: Partial<NormalizedMessage> & {
    id: string;
    senderName: string;
    at: Date;
    content?: string;
  },
): NormalizedMessage {
  return {
    id: partial.id,
    senderName: partial.senderName,
    at: partial.at,
    type: partial.type ?? "text",
    content: partial.content ?? "",
    weight: partial.weight ?? 0.3,
    hasMedia: partial.hasMedia ?? false,
  };
}

/** Shorthand: minutes-from-epoch as a Date. */
function minute(m: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, m, 0));
}

describe("clusterByTopic", () => {
  it("returns [] on empty input", () => {
    expect(clusterByTopic([])).toEqual([]);
  });

  it("returns a single topic for a single message", () => {
    const m = msg({ id: "1", senderName: "Ana", at: minute(0), content: "oi" });
    const topics = clusterByTopic([m]);
    expect(topics).toHaveLength(1);
    expect(topics[0].messages).toHaveLength(1);
    expect(topics[0].participants).toEqual(["Ana"]);
    expect(topics[0].startAt).toEqual(minute(0));
    expect(topics[0].endAt).toEqual(minute(0));
  });

  it("groups messages within gapMinutes into one topic", () => {
    const msgs = [
      msg({ id: "1", senderName: "Ana", at: minute(0) }),
      msg({ id: "2", senderName: "Bia", at: minute(10) }),
      msg({ id: "3", senderName: "Ana", at: minute(25) }),
    ];
    const topics = clusterByTopic(msgs);
    expect(topics).toHaveLength(1);
    expect(topics[0].messages).toHaveLength(3);
    expect(topics[0].participants.sort()).toEqual(["Ana", "Bia"]);
  });

  it("splits into two topics when gap > gapMinutes", () => {
    const msgs = [
      msg({ id: "1", senderName: "Ana", at: minute(0) }),
      msg({ id: "2", senderName: "Bia", at: minute(10) }),
      // 90-minute gap → clearly > default 30
      msg({ id: "3", senderName: "Ana", at: minute(100) }),
      msg({ id: "4", senderName: "Bia", at: minute(110) }),
    ];
    const topics = clusterByTopic(msgs);
    expect(topics).toHaveLength(2);
    expect(topics[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(topics[1].messages.map((m) => m.id)).toEqual(["3", "4"]);
  });

  it("splits on time even when participants overlap fully (gap wins)", () => {
    // Same two participants on both sides of a 2h gap — temporal rule still
    // forces a new topic.
    const msgs = [
      msg({ id: "1", senderName: "Ana", at: minute(0) }),
      msg({ id: "2", senderName: "Bia", at: minute(5) }),
      msg({ id: "3", senderName: "Ana", at: minute(200) }),
      msg({ id: "4", senderName: "Bia", at: minute(205) }),
    ];
    const topics = clusterByTopic(msgs);
    expect(topics).toHaveLength(2);
    expect(topics[0].participants.sort()).toEqual(["Ana", "Bia"]);
    expect(topics[1].participants.sort()).toEqual(["Ana", "Bia"]);
  });

  it("computes dominantKeywords, drops stopwords, caps at 5", () => {
    const msgs = [
      msg({
        id: "1",
        senderName: "Ana",
        at: minute(0),
        content:
          "projeto projeto projeto entrega entrega cliente cliente reuniao prazo bugs",
      }),
      msg({
        id: "2",
        senderName: "Bia",
        at: minute(2),
        // stopwords + noise that must be filtered out
        content: "entao tambem muito para tudo muito como quando agora",
      }),
      msg({
        id: "3",
        senderName: "Ana",
        at: minute(4),
        content: "projeto cliente entrega reuniao bugs",
      }),
    ];
    const [topic] = clusterByTopic(msgs);
    expect(topic.dominantKeywords.length).toBeLessThanOrEqual(5);
    // Highest-count term should come first.
    expect(topic.dominantKeywords[0]).toBe("projeto");
    // Stopwords must not leak in.
    for (const sw of ["entao", "tambem", "muito", "para", "tudo"]) {
      expect(topic.dominantKeywords).not.toContain(sw);
    }
    // All surviving tokens must be len >= 4.
    for (const k of topic.dominantKeywords) {
      expect(k.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("produces a stable id for identical inputs", () => {
    const build = () =>
      clusterByTopic([
        msg({ id: "1", senderName: "Ana", at: minute(0) }),
        msg({ id: "2", senderName: "Bia", at: minute(3) }),
      ]);
    const a = build();
    const b = build();
    expect(a[0].id).toEqual(b[0].id);
    expect(a[0].id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces identical topics regardless of input order (deterministic sort)", () => {
    const a = msg({ id: "1", senderName: "Ana", at: minute(0) });
    const b = msg({ id: "2", senderName: "Bia", at: minute(10) });
    const c = msg({ id: "3", senderName: "Ana", at: minute(20) });

    const ordered = clusterByTopic([a, b, c]);
    const reversed = clusterByTopic([c, b, a]);
    const shuffled = clusterByTopic([b, a, c]);

    expect(ordered).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(shuffled).toHaveLength(1);

    expect(ordered[0].id).toEqual(reversed[0].id);
    expect(ordered[0].id).toEqual(shuffled[0].id);
    expect(ordered[0].messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(reversed[0].messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("does not mutate the input array", () => {
    const msgs = [
      msg({ id: "2", senderName: "Bia", at: minute(10) }),
      msg({ id: "1", senderName: "Ana", at: minute(0) }),
    ];
    const snapshot = msgs.map((m) => m.id);
    clusterByTopic(msgs);
    expect(msgs.map((m) => m.id)).toEqual(snapshot);
  });
});
