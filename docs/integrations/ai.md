# podZAP — AI Integrations

This document covers every external model call the podZAP pipeline makes, the npm
packages required, example code, limits, error handling, and the prompt-engineering
conventions for podcast-style summaries.

All wrappers live in `lib/ai/*` and are re-exported from `lib/ai/index.ts`.
Each wrapper throws `AiError` (see `lib/ai/errors.ts`) with a typed `code` so upstream
pipelines can branch on `missing_env | invalid_input | transcription_failed |
vision_failed | summary_failed | tts_failed | upstream_error`.

Environment variables (declared in `.env.local`):

| Variable                | Purpose                                   |
|-------------------------|-------------------------------------------|
| `GROQ_API_KEY`          | Groq authentication                       |
| `GROQ_STT_MODEL`        | Defaults to `whisper-large-v3`            |
| `GEMINI_API_KEY`        | Google AI Studio key (Gemini Developer)   |
| `GEMINI_VISION_MODEL`   | Defaults to `gemini-2.5-flash`            |
| `GEMINI_LLM_MODEL`      | Defaults to `gemini-2.5-pro`              |
| `GEMINI_TTS_MODEL`      | Defaults to `gemini-2.5-flash-preview-tts`|

---

## Required npm packages

Add to `dependencies` (do **not** install yet — documented only):

```jsonc
{
  "dependencies": {
    "groq-sdk": "^1.1.2",     // Groq Whisper STT
    "@google/genai": "^1.48.0" // Unified Google GenAI SDK (Gemini, Imagen, Veo, TTS)
  }
}
```

> **SDK change discovered:** The older `@google/generative-ai` package is
> deprecated. Google shipped a single unified SDK — `@google/genai` — which reached
> GA in May 2025 and is the recommended library for Gemini as of April 2026.
> The API surface changed: models are accessed via `ai.models.generateContent({...})`
> instead of `genAI.getGenerativeModel(...).generateContent(...)`. Config options
> (`responseModalities`, `speechConfig`, `responseSchema`, etc.) moved into a single
> `config` object on the request.

---

## 1. Groq — Whisper Large v3 (speech-to-text)

Wrapper: `lib/ai/groq.ts` → `transcribeAudio(audio, options?)`

- Accepts `Buffer`, `Blob`, or `{ url: string }`. URLs are fetched server-side.
- Uses `response_format: 'verbose_json'` so we can return `durationSeconds` and
  detected `language` alongside `text`.
- Defaults `language` to `pt` (PT-BR) — override via options.
- Optional `prompt` biases domain vocabulary (<= 224 tokens per Groq docs).

```ts
import { transcribeAudio } from '@/lib/ai';

const { text, durationSeconds } = await transcribeAudio(buffer, {
  language: 'pt',
  prompt: 'Conversa de WhatsApp em português brasileiro sobre futebol.',
});
```

**Rate limits / pricing** (as of Apr 2026, subject to change):
- Free tier: files up to 25 MB.
- Developer tier: up to 100 MB per file.
- `whisper-large-v3`: ~$0.111 per hour of audio.
- `whisper-large-v3-turbo`: ~$0.04 per hour (drop-in cheaper alternative; set
  `GROQ_STT_MODEL=whisper-large-v3-turbo`).

**Error handling:** any SDK throw is re-wrapped as
`AiError('transcription_failed', message, cause)`.

---

## 2. Gemini 2.5 Flash — vision / OCR

Wrapper: `lib/ai/gemini-vision.ts` → `describeImage(image, prompt?)`

- Accepts `Buffer` or `{ url: string }`.
- Sniffs JPEG/PNG/GIF/WEBP magic bytes to pick `mimeType` when given a raw buffer.
- Default prompt (PT-BR) asks for OCR-literal text + concise scene description.

```ts
import { describeImage } from '@/lib/ai';

const { description } = await describeImage({ url: mediaUrl });
```

**Notes:** inline images should stay below ~20 MB per request. For larger media,
use the File API (`ai.files.upload(...)`) — future enhancement.

**Error handling:** empty responses throw `AiError('vision_failed', ...)`. SDK
errors re-wrapped identically.

---

## 3. Gemini 2.5 Pro — podcast summary

Wrapper: `lib/ai/gemini-llm.ts` → `generateSummary(input)`

Returns `{ text, topics, model, promptVersion }`. Uses structured output via
`responseMimeType: 'application/json'` + `responseSchema` to force strictly-typed
JSON (no regex parsing).

### Prompt engineering (podcast tone)

The prompt template (versioned `podzap-summary/v1`) instructs the model to:

1. **Narrate in first-person plural** — "hoje no grupo..." — as a podcast host.
2. **Cite participants by name/nickname** and group messages into topics, not
   by chronological order.
3. Produce **text corrido pronto para locução (TTS)** — no markdown, no bullets,
   no emojis, because the text flows straight into the TTS stage.
4. Target **3–5 minutes of reading (~500–800 palavras)**; open with
   group+period, close with a short gancho.
5. Respect the requested `tone` (`formal | fun | corporate`) with explicit
   per-tone guidance strings.
6. Avoid phone numbers / raw links / sensitive data — paraphrase instead.

Messages are rendered as `- (dd/MM/yyyy HH:mm) Sender [audio transcrito]: content`,
with `[audio transcrito]` / `[imagem descrita]` tags for non-text origins so the
model knows it is consuming derived content, not raw messages.

`topics` is an array of 3–7 short PT-BR phrases used downstream for UI tags and
analytics.

**Error handling:** JSON parse failures, missing `text`, or non-string `topics`
all throw `AiError('summary_failed', ...)`.

---

## 4. Gemini 2.5 Flash Preview — TTS

Wrapper: `lib/ai/gemini-tts.ts` → `generateAudio({ text, voice?, speed? })`

- Voice map: `female → Kore` (warm, mid), `male → Charon` (firm, low).
  Full catalog has 30 prebuilt voices (Zephyr, Puck, Fenrir, Leda, Aoede, …).
- Output from the API is base64 **raw PCM** — 24 kHz, mono, 16-bit signed.
  The wrapper wraps it in a 44-byte RIFF/WAV header in-memory and returns a
  playable `audio/wav` Buffer. No `wav` dependency required.
- `speed` is injected as a natural-language hint into the prompt — the TTS API
  does **not** expose a speed parameter.
- `durationSeconds` is computed from PCM byte length.

```ts
import { generateAudio } from '@/lib/ai';

const { audio, mimeType, durationSeconds } = await generateAudio({
  text: summary.text,
  voice: 'female',
});
```

**Known caveats:**
- Model is currently in preview — expect occasional 429s and voice-name changes.
- No SSML support; control tone via natural-language instructions in the prompt.
- Max input length per call is model-dependent; for very long scripts, chunk
  paragraph-by-paragraph and concatenate WAVs (future enhancement).

**Error handling:** missing audio payload throws `AiError('tts_failed', ...)`.

---

## General error policy

```ts
try {
  const { text } = await transcribeAudio(buf);
} catch (err) {
  if (err instanceof AiError) {
    // err.code is 'missing_env' | 'invalid_input' | 'transcription_failed' | …
    logger.warn({ code: err.code, cause: err.cause }, err.message);
  }
  throw err;
}
```

All wrappers:
- Lazily build their SDK client on first call, via `requireEnv(name)` which
  throws `AiError('missing_env', ...)` if the variable is missing or empty.
- Never log API keys.
- Never retry automatically — retries belong in the pipeline/queue layer.

---

## Open questions

- **TTS voice names:** we hard-coded `Kore` / `Charon` as defaults. Should the
  product team curate a broader male/female shortlist (especially PT-BR-leaning
  voices) and expose them as a `TtsVoice` enum literal per preset?
- **Whisper Turbo vs Large:** should we ship `whisper-large-v3-turbo` as default
  (~2.5× cheaper, slight quality trade-off) or keep full `whisper-large-v3`?
- **Prompt caching / context caching:** Gemini 2.5 Pro supports context caching.
  Worth wiring once summary volume per group grows.
- **Long-form TTS:** no native chunking — need a plan for scripts above the model
  input ceiling.
