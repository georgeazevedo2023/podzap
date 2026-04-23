/**
 * Tests for lib/summary/prompt.ts — podZAP summary prompt builder.
 *
 * Pure unit tests: build a minimal `NormalizedConversation`, run
 * `buildSummaryPrompt`, assert on the returned bundle.
 */
import { describe, expect, it } from "vitest";
import {
  buildSummaryPrompt,
  type SummaryTone,
} from "../lib/summary/prompt";
import type {
  NormalizedConversation,
  NormalizedMessage,
  Topic,
} from "../lib/pipeline/normalize";

function msg(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: "m1",
    senderName: "Alice",
    at: new Date("2026-04-22T12:00:00Z"),
    type: "text",
    content: "Mensagem padrão razoavelmente longa para teste.",
    weight: 0.5,
    hasMedia: false,
    ...overrides,
  };
}

function topic(overrides: Partial<Topic> = {}): Topic {
  const messages = overrides.messages ?? [msg()];
  return {
    id: "t1",
    startAt: new Date("2026-04-22T12:00:00Z"),
    endAt: new Date("2026-04-22T12:30:00Z"),
    messages,
    participants: ["Alice", "Bob"],
    dominantKeywords: ["reunião", "decisão", "prazo"],
    ...overrides,
  };
}

function conv(
  overrides: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    tenantId: "tenant-1",
    groupId: "group-1",
    groupName: "Equipe Kernel",
    periodStart: new Date("2026-04-22T00:00:00Z"),
    periodEnd: new Date("2026-04-22T23:59:59Z"),
    topics: [topic()],
    discarded: 3,
    total: 10,
    ...overrides,
  };
}

const TONES: SummaryTone[] = ["formal", "fun", "corporate"];

describe("buildSummaryPrompt — system prompt by tone", () => {
  it("produces a distinct system prompt for every tone", () => {
    const systemPrompts = new Set(
      TONES.map((t) => buildSummaryPrompt(conv(), t).systemPrompt),
    );
    expect(systemPrompts.size).toBe(TONES.length);
  });

  it("every system prompt contains the podZAP base contract", () => {
    for (const tone of TONES) {
      const { systemPrompt } = buildSummaryPrompt(conv(), tone);
      expect(systemPrompt).toContain("roteirista-apresentador do podZAP");
      expect(systemPrompt).toContain("primeira pessoa plural");
      expect(systemPrompt).toContain("APENAS informação presente nas mensagens");
      expect(systemPrompt).toContain("sem markdown");
    }
  });

  it("tone override adds the expected tone-specific guidance", () => {
    expect(buildSummaryPrompt(conv(), "formal").systemPrompt).toContain(
      "vocabulário formal",
    );
    expect(buildSummaryPrompt(conv(), "fun").systemPrompt).toContain(
      "descontraído",
    );
    expect(buildSummaryPrompt(conv(), "corporate").systemPrompt).toContain(
      "executivo sênior",
    );
  });
});

describe("buildSummaryPrompt — user prompt content", () => {
  it("includes group name, period, and topics block", () => {
    const c = conv({
      groupName: "Time Alpha",
      topics: [
        topic({
          participants: ["Alice", "Bob"],
          dominantKeywords: ["contrato", "cliente"],
        }),
        topic({
          id: "t2",
          participants: ["Carol"],
          dominantKeywords: ["bug", "urgente"],
          messages: [msg({ id: "m2", senderName: "Carol" })],
        }),
      ],
    });
    const { userPrompt } = buildSummaryPrompt(c, "formal");

    expect(userPrompt).toContain("Grupo: Time Alpha");
    expect(userPrompt).toContain("Período:");
    expect(userPrompt).toContain("Tópicos identificados: 2");
    expect(userPrompt).toContain("Tópico 1");
    expect(userPrompt).toContain("Tópico 2");
    // Both topics' keyword sets rendered.
    expect(userPrompt).toContain("contrato, cliente");
    expect(userPrompt).toContain("bug, urgente");
  });

  it("cites participants in the user prompt", () => {
    const c = conv({
      topics: [
        topic({ participants: ["Alice", "Bob", "Carol"] }),
      ],
    });
    const { userPrompt } = buildSummaryPrompt(c, "fun");
    expect(userPrompt).toContain("Participantes: Alice, Bob, Carol");
  });

  it("renders each message with sender, type and content (truncated)", () => {
    const long = "x".repeat(500);
    const c = conv({
      topics: [
        topic({
          messages: [
            msg({ senderName: "Alice", type: "audio", content: long }),
          ],
        }),
      ],
    });
    const { userPrompt } = buildSummaryPrompt(c, "formal");

    expect(userPrompt).toContain("[Alice, audio]:");
    // Content truncated to 300 chars — 500-char input must not appear whole.
    expect(userPrompt).not.toContain(long);
    expect(userPrompt).toContain("x".repeat(300));
  });

  it("emits the exact JSON schema block in the tail", () => {
    const { userPrompt } = buildSummaryPrompt(conv(), "formal");
    expect(userPrompt).toContain("Retorne APENAS JSON");
    expect(userPrompt).toContain('"text":');
    expect(userPrompt).toContain('"topics":');
    expect(userPrompt).toContain('"estimatedMinutes":');
  });
});

describe("buildSummaryPrompt — maxMessagesPerTopic truncation", () => {
  it("truncates rendered messages per topic to the configured limit", () => {
    const messages: NormalizedMessage[] = Array.from({ length: 50 }, (_, i) =>
      msg({ id: `m${i}`, content: `SENTINEL-${i}` }),
    );
    const c = conv({ topics: [topic({ messages })] });

    const { userPrompt } = buildSummaryPrompt(c, "formal", {
      maxMessagesPerTopic: 5,
    });

    // First five must be present…
    for (let i = 0; i < 5; i += 1) {
      expect(userPrompt).toContain(`SENTINEL-${i}`);
    }
    // …and the sixth must be absent.
    expect(userPrompt).not.toContain("SENTINEL-5");
    expect(userPrompt).not.toContain("SENTINEL-49");
  });

  it("defaults to 20 messages per topic when opts omitted", () => {
    const messages: NormalizedMessage[] = Array.from({ length: 30 }, (_, i) =>
      msg({ id: `m${i}`, content: `SENTINEL-${i}` }),
    );
    const c = conv({ topics: [topic({ messages })] });

    const { userPrompt } = buildSummaryPrompt(c, "formal");

    expect(userPrompt).toContain("SENTINEL-19");
    expect(userPrompt).not.toContain("SENTINEL-20");
  });
});

describe("buildSummaryPrompt — empty conversation", () => {
  it("produces a valid prompt bundle when there are zero topics", () => {
    const c = conv({ topics: [], discarded: 0, total: 0, groupName: "" });
    const built = buildSummaryPrompt(c, "formal");

    expect(built.systemPrompt.length).toBeGreaterThan(0);
    expect(built.userPrompt).toContain("Tópicos identificados: 0");
    expect(built.userPrompt).toContain("Total de mensagens: 0");
    // Tail JSON block still present even with no topics.
    expect(built.userPrompt).toContain("Retorne APENAS JSON");
    expect(built.estimatedTokens).toBeGreaterThan(0);
  });
});

describe("buildSummaryPrompt — metadata", () => {
  it("returns positive estimatedTokens proportional to prompt size", () => {
    const small = buildSummaryPrompt(conv({ topics: [] }), "formal");
    const big = buildSummaryPrompt(
      conv({
        topics: Array.from({ length: 5 }, (_, i) =>
          topic({
            id: `t${i}`,
            messages: Array.from({ length: 20 }, (__, j) =>
              msg({ id: `m-${i}-${j}` }),
            ),
          }),
        ),
      }),
      "formal",
    );

    expect(small.estimatedTokens).toBeGreaterThan(0);
    expect(big.estimatedTokens).toBeGreaterThan(small.estimatedTokens);
  });

  it("promptVersion matches `podzap-summary/v1-<tone>` for every tone", () => {
    const pattern = /^podzap-summary\/v1-(formal|fun|corporate)$/;
    for (const tone of TONES) {
      const { promptVersion } = buildSummaryPrompt(conv(), tone);
      expect(promptVersion).toMatch(pattern);
      expect(promptVersion).toBe(`podzap-summary/v1-${tone}`);
    }
  });
});
