# TTS (Fase 9) — Geração de áudio

Referência completa do pipeline que transforma um `summary` aprovado em um arquivo de áudio WAV narrado por Gemini TTS, salvo no Storage e exposto via signed URL.

---

## Overview

Depois que um reviewer aprova um resumo em `/approval/[id]`, o endpoint `POST /api/summaries/[id]/approve` emite o evento Inngest `summary.approved`. O worker `generate-tts` consome o evento, orquestra a chamada ao **Gemini 2.5 Flash Preview TTS**, embrulha o PCM retornado em um container WAV inline, faz upload do arquivo no bucket privado `audios` e insere a row correspondente em `public.audios`. Toda chamada à API Gemini é contabilizada em `ai_calls` via `trackAiCall` (best-effort, nunca bloqueia o caminho principal).

- Model default: `gemini-2.5-flash-preview-tts` (override: `GEMINI_TTS_MODEL`)
- Formato de saída: WAV (24 kHz · mono · PCM 16-bit), com header RIFF montado em memória
- Storage: bucket `audios` (privado), path `<tenantId>/<yyyy>/<summaryId>.wav`
- Retries: 2 (Inngest), `ALREADY_EXISTS` tratado como sucesso-idempotente
- Signed URL: `GET /api/audios/[summaryId]/signed-url`

---

## Flow

```
┌────────────────────┐
│ Reviewer aprova    │ POST /api/summaries/[id]/approve
│ resumo             │ → summaries.status = 'approved'
└─────────┬──────────┘
          │
          │  emit summary.approved { tenantId, summaryId }
          ▼
┌────────────────────────────┐
│ Inngest: generate-tts      │ retries: 2
│ (inngest/functions/        │
│  generate-tts.ts)          │
└─────────┬──────────────────┘
          │
          ▼  step.run('create-audio')
┌────────────────────────────┐
│ createAudioForSummary()    │ lib/audios/service.ts
│                            │
│  1. load summary           │  status MUST be 'approved'
│  2. short-circuit if row   │  throw ALREADY_EXISTS
│     exists                 │
│  3. generateAudio() ──────────────┐
│  4. upload → audios bucket        │
│  5. INSERT audios row             │
│  6. trackAiCall (fire-and-forget) │
└─────────┬──────────────────┘      │
          │                         ▼
          │                ┌────────────────────┐
          │                │ Gemini TTS         │ lib/ai/gemini-tts.ts
          │                │ (PCM → WAV in-mem) │
          │                └────────────────────┘
          ▼
   audios row ready → UI polling em /api/audios/[summaryId]/signed-url
                      retorna playable signed URL
```

---

## Storage

Bucket: **`audios`** (separado do `media`, que guarda mídia original das mensagens).

- **Privacidade**: privado. Sem URLs públicas; acesso exclusivamente via signed URLs geradas pelo backend.
- **Path**: `<tenant_id>/<yyyy>/<summary_id>.wav` (UTC year). Exemplo: `3f2a…/2026/9b1c….wav`.
- **RLS**: análoga ao bucket `media` — policies usam `current_tenant_ids()` para restringir leitura/escrita à pasta do tenant. Admin/service-role client (único caller em `lib/audios/service.ts`) bypassa RLS por construção.
- **Upsert**: `upsert: false`. O service bloqueia reprocessamento via `ALREADY_EXISTS`; se o insert da row falhar após o upload, o objeto órfão é removido em best-effort.

---

## Voices

Gemini TTS usa o catálogo de "prebuilt voices" documentado em <https://ai.google.dev/gemini-api/docs/speech-generation>. O MVP expõe apenas duas opções de alto nível:

| Parâmetro `voice` | Gemini voiceName | Perfil                    |
| ----------------- | ---------------- | ------------------------- |
| `female` (default)| `Kore`           | morna, registro médio     |
| `male`            | `Charon`         | firme, registro grave     |

Mapeamento fica em `lib/ai/gemini-tts.ts` → `VOICE_MAP`. Para expor mais vozes (`Puck`, `Aoede`, `Fenrir`, …) basta estender o map + o union type `TtsVoice`. Nenhuma migração de DB é necessária — a coluna `audios.voice` é `text`.

Não há teste formal de qualidade PT-BR por voice name — o prompt (`Narre em português do Brasil…`) é o que força o idioma; a voice name controla só o timbre.

---

## Speed

Gemini TTS **não** expõe um parâmetro numérico de velocidade. O service aceita `speed?: number` mas apenas o injeta como uma dica textual no prompt:

- `speed > 1` → `"um pouco mais rápido que o normal"`
- `speed < 1` → `"em ritmo pausado"`
- `speed === 1` ou omitido → nenhuma modulação

Resultado: efeito qualitativo e não determinístico. Para controle real de cadência seria preciso pós-processar o WAV (time-stretch SoX / FFmpeg) — fora do escopo do MVP. A coluna `audios.speed` guarda o valor recebido apenas para auditoria.

---

## Audio format

Gemini TTS retorna PCM cru (signed 16-bit, little-endian, 24 kHz, mono) encodado em base64 dentro de `response.candidates[0].content.parts[0].inlineData.data`. `lib/ai/gemini-tts.ts::pcmToWav` monta um header RIFF de 44 bytes em memória e concatena com o PCM:

```
RIFF<size>WAVEfmt <16><1><channels><sampleRate><byteRate><blockAlign><bits>data<dataSize><PCM…>
```

- Nenhuma dependência nativa (`wav`, `node-wav`, `ffmpeg`) — tudo `Buffer`.
- `TtsResult.durationSeconds` é computado a partir do comprimento do PCM: `samples / SAMPLE_RATE_HZ`.
- `TtsResult.mimeType = 'audio/wav'`.

**Compressão para MP3 é pós-MVP.** Um arquivo típico de 3–5 min de narração ocupa ~8–14 MB em WAV 24 kHz mono. Para reduzir custo de banda em entrega (Fase 10+), um step adicional pode rodar `ffmpeg -i … -b:a 64k out.mp3`; requer binário `ffmpeg` disponível no runtime Inngest/Vercel.

---

## Chunking

**Gap conhecido.** O wrapper atual **não** faz chunking de textos longos. A Gemini TTS tem limite prático de ~5000 caracteres por chamada; acima disso a API pode devolver `tts_failed` ou truncar silenciosamente.

O plano original (`docs/plans/fase-9-plan.md` → Riscos) previa `chunk + concat` para resumos grandes, mas a implementação foi deixada para depois. Mitigações atuais:

- Resumos gerados na Fase 7 costumam ficar em 2–4 KB (Gemini 2.5 Pro alvo de 3–5 min de leitura), então o limite raramente é atingido na prática.
- Falhas acima do limite sobem como `AudiosError('TTS_ERROR')` e são visíveis no dashboard Inngest após os 2 retries.

Implementação futura: dividir `summary.text` por parágrafo até ~4000 chars, gerar um WAV por chunk, concatenar PCMs antes do `pcmToWav` (um único header cobre tudo; samplerate/channels são constantes).

---

## API

### `GET /api/audios`

Lista áudios do tenant autenticado, mais recentes primeiro.

- Auth: sessão Supabase obrigatória.
- Query params: `limit` (default 20, clamp `[1, 100]`).
- Response: `{ audios: AudioView[] }` — ver `lib/audios/service.ts::AudioView`.

### `GET /api/audios/[summaryId]/signed-url`

Retorna uma signed URL para tocar/baixar o áudio associado a um summary.

- Auth: sessão Supabase obrigatória; o service confere `tenant_id`.
- Response 200: `{ url: string, expiresIn: number }`
- Response 404: áudio ainda não gerado (UI deve continuar o polling) ou summary de outro tenant.
- Uso típico na UI de aprovação: poll a cada 2–3 s enquanto mostra "gerando áudio…"; ao receber 200, renderiza `<audio controls src={url}>` + link de download.

---

## Troubleshooting

### Gemini safety block

Sintomas: `AudiosError('TTS_ERROR')` com mensagem vinda de `AiError('tts_failed', …)`. Geralmente `response.candidates[0]` existe mas `inlineData.data` está vazio (o wrapper converte em `Gemini TTS returned no audio payload`).

Causas comuns:

- Conteúdo do resumo disparou filtro de safety da Gemini (raro, dado que os resumos são gerados por outra chamada Gemini que também passa pelos filtros).
- Voice name inválido (typo em `VOICE_MAP`).

Investigação: ver o log do worker no dashboard Inngest; o `AiError` carrega o erro original em `cause`. Para resumos que consistentemente falham, editar o texto na UI de aprovação antes de re-aprovar — o editor salva e o próximo `summary.approved` re-dispara o TTS após o `getAudioBySummary` voltar `null` (só volta se o insert anterior falhou e o cleanup rodou; se a row já existe, `ALREADY_EXISTS` protege).

### Empty text

`createAudioForSummary` só carrega summaries `status='approved'`. `generateAudio` rejeita `text.trim().length === 0` com `AiError('invalid_input', 'TTS input text is empty')` → vira `AudiosError('TTS_ERROR')`. Não deve acontecer no pipeline normal — summaries vazios são bloqueados pelo editor da Fase 8. Se acontecer, provavelmente é um registro sintético/seed; delete a row ou escreva texto válido e re-aprove.

### Storage upload fail

Sintomas: `AudiosError('DB_ERROR', 'Storage upload failed for summary …')`.

Causas:

- Bucket `audios` não existe (rodar o script de criação do bucket).
- RLS policies do Storage bloqueando o service-role (verificar `storage.objects` policies — service-role bypassa, mas configurações restritivas em `storage.buckets` podem interferir).
- Colisão de path com `upsert: false` (não deveria acontecer — `ALREADY_EXISTS` bloqueia upstream; se acontecer, o objeto órfão foi deixado por uma falha de insert anterior — remover manualmente no Supabase Dashboard).

Retries do Inngest cobrem transientes (3 tentativas totais). Após isso, a falha aparece no dashboard; investigar e re-disparar aprovação manualmente.
