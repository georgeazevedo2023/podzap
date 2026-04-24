# Crypto (AES-256-GCM)

Arquivo-fonte: [`lib/crypto.ts`](../../lib/crypto.ts).
Testes: [`tests/crypto.spec.ts`](../../tests/crypto.spec.ts).

Único consumidor de produção hoje: **token UAZAPI por instância** (`whatsapp_instances.uazapi_token_encrypted`), persistido em `lib/whatsapp/service.ts` e `lib/admin/uazapi.ts`.

## O que é

Wrapper mínimo em volta de `node:crypto` AES-256-GCM. Dois pontos de entrada:

```ts
encrypt(plaintext: string): string   // → "<iv>.<ct>.<tag>"
decrypt(payload:   string): string   // → plaintext, ou CryptoError
```

Mais um utilitário de comparação constant-time (`safeEqual`) colocado aqui porque todos os primitivos criptográficos vivem no mesmo módulo.

## Parâmetros (`lib/crypto.ts:30-34`)

| Constante | Valor | Nota |
|---|---|---|
| `ALGO` | `aes-256-gcm` | AEAD: confidencialidade + integridade numa chamada |
| `KEY_BYTES` | 32 | AES-256 exige 256 bits de chave |
| `IV_BYTES` | 12 | Tamanho recomendado pra GCM (96 bits) |
| `TAG_BYTES` | 16 | Tag de autenticação GCM (128 bits) |
| `SEPARATOR` | `.` | ASCII seguro em qualquer coluna `text` Postgres |

## Chave

Variável de ambiente **`ENCRYPTION_KEY`**, codificada em **base64** e decodando para exatos 32 bytes. Resolvida lazy via `loadKey()` (`lib/crypto.ts:54-75`) para permitir testes mutarem `process.env.ENCRYPTION_KEY` antes de usar.

Falhas típicas (todas raise `CryptoError`):

| Erro | Causa | Remediação |
|---|---|---|
| `MISSING_KEY` | Env var não definida | Gerar `openssl rand -base64 32` e adicionar em `.env.local` e no stack Portainer |
| `INVALID_KEY` | Não é base64 válido ou não dá 32 bytes | Chave truncada/com espaços |
| `INVALID_FORMAT` | `encrypt` chamado com não-string, ou `decrypt` com payload vazio / sem 2 separadores | Bug no chamador |
| `INVALID_IV` / `INVALID_TAG` | Partes truncadas / tamanho errado | Ciphertext corrompido em trânsito |
| `DECRYPT_FAILED` | Auth tag mismatch — **tampering** ou chave errada | Rotação de chave sem re-encrypt, ou ataque |

### Boot-time validation

**Não existe** boot validation explícita no código atual. `loadKey()` só roda no primeiro `encrypt` / `decrypt`. Isso significa que um deploy com `ENCRYPTION_KEY` faltando sobe limpo e só quebra na primeira conexão WhatsApp.

**Débito**: adicionar healthcheck inicial em `app/instrumentation.ts` (ou similar) que faz `encrypt('boot')`/`decrypt(...)` round-trip pra falhar rápido. Rastreável como TODO futuro.

## Formato do ciphertext

```
<iv_b64>.<ciphertext_b64>.<auth_tag_b64>
```

Pura ASCII base64 + separador — **não** base64 do pacote completo. Isso é intencional:

1. Debug amigável — dá pra inspecionar o payload colando em qualquer base64 decoder.
2. Qualquer coluna `text` serve (não precisa `bytea`).
3. Permite rotacionar IV sem re-encode.

Exemplo real (truncado):
```
jGk2KO93p4f1aGlX.Q2VzdGFyaWFBdG9rZW5j.xyzabc...
```

## IV handling

**Aleatório por chamada** (`randomBytes(12)`, `lib/crypto.ts:82`). Nunca reutilizar IV com a mesma chave em GCM — catastrófico (permite recuperar XOR dos plaintexts + forjar tags). O randomizer de `node:crypto` usa OpenSSL — suficiente pro cenário.

## `safeEqual(a, b)`

Comparação string constant-time via `timingSafeEqual`. Curto-circuita em lengths diferentes (`lib/crypto.ts:156-158`) — isso **vaza comprimento**, que é ok para HMAC de tamanho conhecido (ex: comparar webhook secret).

## Rotação de chave (plano futuro)

Nenhuma infra-estrutura de rotação ainda existe. Plano incremental quando necessário:

1. Adicionar `ENCRYPTION_KEY_PREVIOUS` como lista (JSON array em env).
2. `decrypt` tenta key atual → cada uma das anteriores em ordem.
3. `encrypt` **sempre** usa a atual.
4. Script one-shot `scripts/rotate-encryption.mjs` itera `whatsapp_instances`, decrypta com previous → encrypta com current → update.
5. Após migração completa, remove previous.

Observação: cada payload já é self-contained (IV embutido), então a única blocker é o código saber qual chave usar. Nada no formato impede rotação.

## Testes (`tests/crypto.spec.ts`)

Cobertura esperada (conferir com `cat tests/crypto.spec.ts` em caso de dúvida):

- Round-trip `decrypt(encrypt(x)) === x` pra strings ASCII, Unicode, strings vazias.
- `encrypt(x) !== encrypt(x)` — IVs diferentes cada vez.
- `CryptoError('MISSING_KEY')` quando env ausente.
- `CryptoError('INVALID_KEY')` com base64 inválido e com tamanho errado.
- `CryptoError('INVALID_FORMAT')` em payload sem 3 partes.
- `CryptoError('DECRYPT_FAILED')` com ciphertext adulterado.
- `safeEqual` retornando `true`/`false` corretamente + indiferente a timing.

## Gotchas

1. **Server-only.** Importar em Client Component = bundler erro ou (pior) key no bundle. Enforcement é convencional — não há `"use server"` no arquivo.
2. **`encrypt` é não-determinístico.** Não use como hash/fingerprint — mesmo input gera saídas diferentes. Pra fingerprint estável: `crypto.createHash('sha256').update(x).digest('hex')`.
3. **Pares `ENCRYPTION_KEY` por ambiente.** Dev, staging, prod têm keys distintas — ciphertext de um não descodifica no outro. Isso é feature (blast radius).
4. **Key != secret arbitrário.** Se alguém setar `ENCRYPTION_KEY=hunter2` (não-base64), o boot não avisa — a falha é `INVALID_KEY` em runtime. Ver débito de boot validation acima.
