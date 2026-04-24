# Media download + signed URLs

Arquivos-fonte:
- [`lib/media/download.ts`](../../lib/media/download.ts) — download + store
- [`lib/media/signedUrl.ts`](../../lib/media/signedUrl.ts) — read-side

Workers que orquestram: [`inngest/functions/retry-pending.ts`](../../inngest/functions/retry-pending.ts) (cron `*/5m`), [`inngest/functions/media-download-retry.ts`](../../inngest/functions/media-download-retry.ts) (event-driven).

Testes: [`tests/media-download.spec.ts`](../../tests/media-download.spec.ts), cobrindo SSRF guards, MIME sniff, tamanho máximo, marcação de falha.

## Visão geral do fluxo

```
UAZAPI webhook body tem { mediaUrl, mimeType? }
    │
    ▼
lib/webhooks/persist.ts
    │ INSERT messages(media_download_status='pending', media_url=mediaUrl)
    │ inngest.send('message.captured')
    ▼
inngest/functions/retry-pending.ts  (cron */5m)
    │ SELECT messages WHERE media_download_status='pending'
    │ for each → inngest.send('media.download.retry', { messageId })
    ▼
inngest/functions/media-download-retry.ts
    │ downloadAndStore(tenantId, messageId, mediaUrl)
    ▼
lib/media/download.ts#downloadAndStore
    1. validateSourceUrl → bloqueia SSRF (IP privado, loopback, scheme ruim)
    2. fetch com AbortSignal (timeout 30s)
    3. drainWithCap → Buffer com hard cap 50 MiB
    4. sniffMimeType (magic bytes) → ext
    5. Storage upload bucket 'media' → <tenant>/<yyyy>/<mm>/<messageId>.<ext>
    6. UPDATE messages SET media_storage_path, mime, size, status='downloaded'

Leitura (worker transcribe, UI history):
    ▼
lib/media/signedUrl.ts#getSignedUrl(storagePath)
    → admin.storage.from('media').createSignedUrl(path, 3600)
    → URL válida 1h
```

## Bucket layout

**Privado** (não listado, sem signed download URL público). Criado via migration `db/migrations/0002_*` (bucket `media`) e `0005_audios.sql` (bucket `audios`).

Path convention (`lib/media/download.ts:203-207`):
```
<tenant_id>/<yyyy>/<mm>/<message_id>.<ext>
```

- `<tenant_id>` primeiro = isolamento por folder (facilita delete em bulk por tenant).
- `<yyyy>/<mm>` = particionamento temporal (reduz listings por pasta).
- Ext determinada por `mimeToExtension()` do MIME descoberto (`lib/media/download.ts:179-197`).

## Signed URLs

`getSignedUrl(path, optsOrExpires?)` (`lib/media/signedUrl.ts:43-73`):

**Default: 1 hora, bucket `media`.**

Três formas de chamar (back-compat):
```ts
getSignedUrl(path)                       // media, 3600s
getSignedUrl(path, 600)                  // media, 600s (legacy number)
getSignedUrl(path, { bucket: 'audios' }) // audios, 3600s
getSignedUrl(path, { bucket: 'audios', expiresInSeconds: 900 })
```

Erros sobem como `SignedUrlError` — callers decidem degradar (ex: `lib/stats/service.ts:259-275` engole a falha e retorna `null` pro card, que renderiza sem botão de play).

**Por que 1 hora default**: balanço entre não forçar re-fetch durante um player session (~30min max de áudio) e limitar o raio se o link vazar em log / clipboard / history.

## SSRF guards (`download.ts:60-114`)

O worker faz `fetch(mediaUrl)` no ambiente server. Sem guards, isso vira SSRF (chamar `http://169.254.169.254/latest/...` dentro da VPC = IAM credentials do EC2, se estivesse em AWS — na Hetzner/Portainer o risco é o metadata/IPMI local).

**Bloqueios aplicados (literal IP only — sem DNS):**

```
IPv4: 127/8, 10/8, 0/8, 169.254/16, 172.16/12, 192.168/16
IPv6: ::1, ::, fe8x/fe9x/feax/febx (link-local), fcxx/fdxx (ULA),
      ::ffff:<v4> re-checked como v4
```

Hostnames: bloqueia `localhost`, `ip6-localhost`, `ip6-loopback`.

Schemes: só `https://`. Em `NODE_ENV !== 'production'` aceita `http://` (ngrok em dev).

**Limitação assumida (`download.ts:18-22`)**: não faz `dns.lookup(host)` pré-fetch. Se um atacante controla um DNS que resolve para IP privado, passa. **Mitigação atual**: URLs vêm do webhook UAZAPI — gateway confiável. Antes de aceitar URLs de fonte não-confiável, adicionar pre-lookup + pinagem.

## Timeouts + caps

| Parâmetro | Default | Onde |
|---|---|---|
| `timeoutMs` | 30 000 ms | `AbortController` em volta do `fetch` (`download.ts:275-276`) |
| `maxSizeBytes` | 50 MiB | Checado no `Content-Length` header (early bail) **e** no drain do stream |
| `drainWithCap` early cancel | Stream `.cancel()` quando ultrapassa max | `download.ts:210-230` |

Ordem de checagem: **Content-Length** antes de começar a drenar (barato), depois streaming com cap progressivo (defesa contra Content-Length mentiroso / chunked transfer sem header).

## MIME sniff (magic bytes)

`sniffMimeType(buf)` (`download.ts:136-177`) inspeciona primeiros 12 bytes. Formatos reconhecidos:

- Imagens: PNG, JPEG, GIF (87a/89a), WebP
- Áudio: OGG/Opus (WhatsApp padrão), MP3 (ID3 + raw frame sync), M4A (via `ftyp M4A`)
- Vídeo: MP4 (via `ftyp` sem sub-brand de áudio)

Cascata de fallback se sniff falhar: `Content-Type` do response → `opts.hintedMime` (UAZAPI payload) → `application/octet-stream`.

## Failure handling

**Best-effort** — `downloadAndStore` **nunca throws** (`download.ts:18-19`). Retorna `DownloadResult`:

```ts
{ status: 'downloaded', storagePath, mimeType, sizeBytes }
{ status: 'failed',     error: '<reason>' }
{ status: 'skipped',    error: 'empty sourceUrl' }
```

Em caso de `failed`, `markFailed` atualiza `media_download_status='failed'` via admin client (`download.ts:232-248`). O próprio `markFailed` engole erros — ele já é a rota de falha.

## Gotchas

1. **Webhook NÃO aguarda o download.** A resposta 200 volta antes. O worker cron pega o `pending` e baixa out-of-band. Isso significa que `messages.media_storage_path` vai estar `null` por até ~5min após captura.
2. **`upsert: false` no upload** (`download.ts:336`). Tentar baixar a mesma message duas vezes causa erro no Storage. Idempotência depende do check `media_download_status` antes de chamar (feito em `retry-pending.ts`).
3. **SSRF guards são literais-only.** Ver limitação DNS acima.
4. **Sem CDN.** Toda leitura cria signed URL fresco → Supabase Storage. Em volume, considerar CloudFront/Bunny na frente do bucket.
5. **Nenhum antivirus / content scan.** Confiamos em UAZAPI como origem. Se aceitar upload direto do user, adicionar pipeline de scan.
6. **Buckets são hardcoded** em `DEFAULT_BUCKET`/constantes. Tenancy é via path prefix, não bucket — um bug que esqueça `tenant_id` no path permite cross-tenant read via signed URL se o path for adivinhado (path usa UUID, então brute-force é inviável, mas disciplina ainda importa).

## Testes cobrem

- Round-trip com body stream bem comportado.
- Bloqueio de `http://127.0.0.1/...`, `http://10.0.0.5/...`, `http://localhost/...`, `file://`.
- Truncate em Content-Length acima do cap.
- Truncate via streaming quando Content-Length ausente/mentiroso.
- Magic bytes recognition (PNG, JPEG, OGG, MP3, MP4).
- `markFailed` chamado em cada caminho de falha.
