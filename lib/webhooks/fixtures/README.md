# Webhook fixtures

Gravações sintéticas de eventos UAZAPI para o disparador local
(`POST /api/webhooks/test`). Fase 4.

## Por que fixtures em vez de payloads reais?

Não requerem ngrok nem uma instância UAZAPI conectada. Boas para iteração
rápida em `lib/webhooks/{validator,handler,persist}.ts`. Payloads reais
ainda são necessários para validar edge cases (tipos esotéricos de mídia,
envelopes PascalCase de peer gateways) — capturar esses manualmente com
`curl -X POST localhost:3001/api/webhooks/uazapi -d @real-capture.json`
depois que tivermos URL pública.

## Placeholders

As fixtures não hardcodeiam IDs — a rota de teste substitui no runtime:

| Placeholder | Fonte |
| --- | --- |
| `__TENANT_ID__` | `whatsapp_instances.tenant_id` (mais recente, ou `?tenant=<uuid>`) |
| `__INSTANCE_UAZAPI_ID__` | `whatsapp_instances.uazapi_instance_id` |
| `__GROUP_JID__` | primeiro `groups.uazapi_group_jid` do tenant (preferindo `is_monitored=true`) |
| `__UNMONITORED_GROUP_JID__` | JID literal bogus (`120363999999999999@g.us`) que nunca resolve |
| `__DIRECT_JID__` | JID 1:1 literal (`5511999998888@s.whatsapp.net`) |

Substituição é string-replace global sobre o texto JSON bruto; nomes de
chave em fixtures nunca contêm duplo-underscore, portanto não há colisão.

## Fixtures disponíveis

| Arquivo | Cenário | Resultado esperado do handler |
| --- | --- | --- |
| `text.json` | Mensagem de texto em grupo monitorado | `persisted` |
| `audio.json` | Voice note (ptt) em grupo monitorado, com `mediaUrl` | `persisted` + download da mídia |
| `image.json` | Imagem JPEG em grupo monitorado | `persisted` + download da mídia |
| `connection.json` | `connection.update` → `connected` | `ignored` (apenas logamos transição) ou update em `whatsapp_instances.status` |
| `direct.json` | Mensagem 1:1 (não-grupo) | `ignored` (reason: "direct") |
| `unmonitored.json` | Mensagem em grupo fora de `is_monitored` | `ignored` (reason: "unmonitored") |

## Uso

```bash
# Texto em grupo monitorado
curl -X POST http://localhost:3001/api/webhooks/test \
  -H 'content-type: application/json' \
  -d '{"fixture":"text"}'

# Forçar tenant específico (útil em bases com múltiplos tenants)
curl -X POST 'http://localhost:3001/api/webhooks/test?tenant=<uuid>' \
  -H 'content-type: application/json' \
  -d '{"fixture":"audio"}'
```

Resposta:

```json
{
  "ok": true,
  "fixture": "text",
  "context": { "tenantId": "...", "uazapiInstanceId": "...", "groupJid": "..." },
  "result": { "status": "persisted", "messageId": "..." }
}
```

## Disparador vs webhook real

A rota `/api/webhooks/test` **bypass o check de secret** — não passa pelo
`validateSecret()`. Para testar o caminho real (incluindo secret), use:

```bash
curl -X POST "http://localhost:3001/api/webhooks/uazapi?secret=$UAZAPI_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d @lib/webhooks/fixtures/text.json
```

(Note que os placeholders não são substituídos nesse caminho — precisa
editar o arquivo à mão primeiro.)
