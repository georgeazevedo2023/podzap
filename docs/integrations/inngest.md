# Inngest — pipeline assíncrono

> Referência da integração Inngest usada pela Fase 5 (transcrição
> multimodal). Complementa `docs/plans/fase-5-plan.md` com o "como rodar"
> no dia a dia.

---

## Overview

Inngest é o barramento de **eventos + workers + cron** que roda fora do
request-cycle do Next.js. É usado para o pipeline assíncrono de download
de mídia e transcrição/descrição:

- Recebe eventos emitidos pelo webhook handler (`lib/webhooks/persist.ts`)
  assim que uma mensagem é persistida.
- Roda funções que carregam a mensagem, garantem o download da mídia para
  o Supabase Storage, e chamam Groq Whisper (áudio) ou Gemini Vision
  (imagem) para produzir texto, persistindo em `transcripts`.
- Cron de segurança refaz downloads pendentes e retranscreve falhas.

Tudo isso desacopla o webhook da UAZAPI (que tem timeout agressivo) do
trabalho pesado de rede + IA. O webhook só precisa gravar a linha e
disparar `message.captured`; o Inngest cuida do resto com retry.

---

## Events

| Event                             | Origem                                          | Payload (chaves) |
|-----------------------------------|-------------------------------------------------|------------------|
| `message.captured`                | `lib/webhooks/persist.ts` (após insert)         | `messageId`, `tenantId`, `type` |
| `message.transcription.requested` | re-transcrição on-demand (UI / backfill)        | `messageId` |
| `media.download.retry`            | retry de download quando `media_download_status='pending'` | `messageId` |

Os nomes dos eventos são **literais e case-sensitive** — se digitar
`message_captured` (underscore) ou `Message.Captured` o worker simplesmente
não é invocado e o evento aparece como "unhandled" no dashboard. O mapa
canônico vive em `inngest/events.ts`.

---

## Functions

| Nome                       | Trigger                                              | Faz                                                                 |
|----------------------------|------------------------------------------------------|---------------------------------------------------------------------|
| `ping`                     | `inngest/health.ping`                                | Health check — devolve `pong`. Útil para validar wiring sem custo.  |
| `transcribe-audio`         | event `message.captured` onde `data.type === 'audio'`| Carrega message → garante download → Groq Whisper → upsert transcripts |
| `describe-image`           | event `message.captured` onde `data.type === 'image'`| Carrega message → garante download → Gemini Vision → upsert transcripts |
| `retry-pending-downloads`  | cron `*/5 * * * *`                                   | Acha messages com `media_download_status='pending'` há > 2min e refaz |
| `transcription-retry`      | cron `*/15 * * * *`                                  | Acha mensagens áudio/imagem sem `transcripts` e re-dispara o event  |
| `media-download-retry`     | event `media.download.retry`                         | Refaz download on-demand (backoff exponencial).                     |

---

## Dev setup

> **IMPORTANTE:** `INNGEST_DEV=1` é obrigatório em `.env.local`. Sem ele o
> Inngest SDK assume "cloud mode" e o serve handler retorna **500** com
> `cloud mode but no signing key` — essa é a dor de cabeça número 1 de
> quem sobe o projeto pela primeira vez.

1. Crie/edite `.env.local`:

   ```env
   INNGEST_DEV=1
   # em dev NÃO precisa INNGEST_EVENT_KEY nem INNGEST_SIGNING_KEY
   ```

2. Em um terminal, rode a app Next:

   ```bash
   npm run dev
   ```

   Ela sobe em `http://localhost:3001` (a porta é controlada por
   `package.json`). O handler fica exposto em `/api/inngest`.

3. Em paralelo, rode o Inngest dev server apontando para o handler:

   ```bash
   npx inngest-cli@latest dev -u http://localhost:3001/api/inngest
   ```

4. Abra o dashboard: [http://127.0.0.1:8288](http://127.0.0.1:8288).
   Nele você vê:
   - Functions registradas (se não aparecerem, veja Troubleshooting).
   - Events recebidos em tempo real.
   - Runs com logs por step + possibilidade de "Rerun".

### Dispatch manual de evento (smoke test)

```bash
curl -X POST http://127.0.0.1:8288/e/podzap-local \
  -H "content-type: application/json" \
  -d '{
    "name": "message.captured",
    "data": { "messageId": "<uuid-existente>", "tenantId": "<uuid>", "type": "audio" }
  }'
```

A função `transcribe-audio` deve aparecer no dashboard como "Running" em
segundos.

---

## Prod setup

Em produção (Vercel) o Inngest roda via **Inngest Cloud**:

1. Crie um projeto em [app.inngest.com](https://app.inngest.com).
2. Copie `Event Key` e `Signing Key`.
3. No Vercel, em _Environment Variables_, adicione:

   ```
   INNGEST_EVENT_KEY=<event-key>
   INNGEST_SIGNING_KEY=signkey-prod-…
   ```

   **Não** defina `INNGEST_DEV` em prod (ou defina `INNGEST_DEV=0`).

4. Após deploy, registre a app em Inngest Cloud apontando para
   `https://<your-domain>/api/inngest`. O SDK se auto-registra no primeiro
   request e as funções aparecem no dashboard.

Os crons rodam automaticamente pela Inngest Cloud — não precisa de
Vercel Cron nem GitHub Actions.

---

## Retry policy

Por padrão cada função Inngest retenta **3x com backoff exponencial**
(~10s, ~30s, ~2min). As funções de transcrição/descrição usam esse default
porque Groq e Gemini têm picos ocasionais de 429/503.

Para falhas determinísticas (ex.: Gemini bloqueou imagem sensível), a
função trata como "no retry" marcando a mensagem e retornando sem lançar
— a cron `transcription-retry` não vai re-agendar porque a linha em
`transcripts` (ou a flag de falha) já existe.

---

## Troubleshooting

| Sintoma                                                 | Causa provável                                               | Fix                                                                          |
|---------------------------------------------------------|--------------------------------------------------------------|------------------------------------------------------------------------------|
| `500 cloud mode but no signing key` em `/api/inngest`   | Rodando em dev sem `INNGEST_DEV=1`                           | Adicione `INNGEST_DEV=1` em `.env.local` e reinicie `npm run dev`            |
| Dashboard abre mas "No functions registered"            | Dev CLI apontando para URL/porta errada                      | Confira `npx inngest-cli dev -u http://localhost:3001/api/inngest` (porta!)  |
| Evento dispatched mas nenhuma função roda               | Nome do evento não bate com o trigger                        | Confira `inngest/events.ts` — é `message.captured` (ponto), não underscore   |
| Groq "file too large"                                   | Áudio > 25MB (limite do Whisper)                             | Implementar chunking (issue futura) ou descartar com flag                    |
| Gemini retorna bloqueio de safety                       | Imagem sensível                                              | Marcar `transcription_failed` sem retry e seguir                             |
| Cron não dispara em prod                                | `INNGEST_DEV=1` ficou em prod                                | Remova do Vercel env e redeploy                                              |
| Função roda mas `messages` não existe                   | Evento dispatchado com `messageId` inválido (teste manual)   | Use um UUID real de `messages` — ou proteja a função com um early-return     |

---

## Referências

- Código: `app/api/inngest/route.ts`, `inngest/client.ts`, `inngest/events.ts`, `inngest/functions/*`
- Plano: `docs/plans/fase-5-plan.md`
- Service layer: `lib/transcripts/service.ts`
- Emissor de eventos: `lib/webhooks/persist.ts`
