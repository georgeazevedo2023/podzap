---
name: podzap-test-webhook
description: Simula webhook UAZAPI (wsmart shape) com HMAC válido e POST pra prod ou local. Triggers - "testar webhook", "simular áudio", "mandar webhook fake", "test uazapi webhook". Verifica DB row criada após.
---

# podzap-test-webhook

Simula um webhook UAZAPI com payload wsmart-shape válido e HMAC assinado, manda pra app, e verifica se chegou no DB.

## Quando usar

- Validar parser depois de mudança em `lib/uazapi/types.ts::normaliseUazapiMessageContent`
- Reproduzir bug de webhook reportado pelo user
- Testar o caminho completo (parser → persist → download → transcript) sem precisar mandar mensagem real do celular
- Sanity check após deploy

## Pré-requisitos

- `.env.local` com `UAZAPI_WEBHOOK_HMAC_SECRET` (mesmo valor que está no n8n flow node "Sign HMAC")
- App rodando (local em `:3000` ou prod `https://podzap.wsmart.com.br`)
- Pelo menos 1 grupo monitorado pra que `persist.ts` não skipe ("unknown group")

## Passos

1. Pega o secret HMAC:
```bash
grep "^UAZAPI_WEBHOOK_HMAC_SECRET=" .env.local | cut -d= -f2-
```

2. Pega um `uazapi_group_jid` de grupo monitorado:
```bash
node --env-file=.env.local scripts/db-query.mjs --sql \
  "select uazapi_group_jid, name from groups where is_monitored = true limit 1"
```

3. Cria script temp em `C:/Users/georg/AppData/Local/Temp/test-webhook.mjs`:

```javascript
import { createHmac } from 'node:crypto';

const SECRET = '<HMAC_SECRET>';
const URL = '<https://podzap.wsmart.com.br | http://localhost:3000>/api/webhooks/uazapi';
const GROUP_JID = '<jid de grupo monitorado>';
const INSTANCE_NAME = '<uazapi_instance_name do tenant>';
const MESSAGE_ID = `TEST_${Date.now()}`;

// Shape pra TEXTO (mais simples — não precisa download)
const body = {
  BaseUrl: 'https://wsmart.uazapi.com',
  EventType: 'messages',
  chat: { name: 'Test Group', wa_chatid: GROUP_JID, wa_isGroup: true },
  instanceName: INSTANCE_NAME,
  message: {
    chatid: GROUP_JID,
    fromMe: false,
    id: `558193856099:${MESSAGE_ID}`,
    isGroup: true,
    messageTimestamp: Date.now(),
    messageType: 'Conversation',
    messageid: MESSAGE_ID,
    sender: '90044006187258@lid',
    senderName: 'Claude Test',
    type: 'text',
    text: 'mensagem de teste do skill podzap-test-webhook',
  },
  owner: '558193856099',
  token: 'tok',
};

// Pra ÁUDIO, troca message pra:
//   messageType: 'AudioMessage', mediaType: 'ptt', type: 'media',
//   content: { URL: '<.enc URL ou plain>', mimetype: 'audio/ogg; codecs=opus',
//              fileLength: 6034, seconds: 2, PTT: true },
//   text: ''
// (URL .enc precisa que UAZAPI_WEBHOOK_HMAC_SECRET + ENCRYPTION_KEY estejam OK)

const raw = JSON.stringify(body);
const hmac = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-podzap-signature': hmac },
  body: raw,
});
console.log('status:', res.status, '| body:', await res.text());
```

4. Roda:
```bash
node C:/Users/georg/AppData/Local/Temp/test-webhook.mjs
```

5. Verifica DB:
```bash
node --env-file=.env.local scripts/db-query.mjs --sql \
  "select id, type, content, media_download_status, captured_at from messages \
   where uazapi_message_id = '<MESSAGE_ID>'"
```

6. Limpa:
```bash
rm -f C:/Users/georg/AppData/Local/Temp/test-webhook.mjs
node --env-file=.env.local scripts/db-query.mjs --sql \
  "delete from messages where uazapi_message_id = '<MESSAGE_ID>'"
```

## Códigos de status esperados

| HTTP | Significado |
|---|---|
| 200 + `{ok: true, status: "persisted"}` | Sucesso — row criada |
| 200 + `{ok: true, status: "ignored", reason: "unknown group"}` | GROUP_JID não está monitorado — re-checar passo 2 |
| 401 "invalid HMAC signature" | Secret diferente do usado no n8n. Re-conferir env. |
| 500 "Webhook server misconfigured" | `UAZAPI_WEBHOOK_HMAC_SECRET` não setado em prod (ver Portainer) |
| 504 Gateway Timeout | Container reiniciando (deploy em curso) |

## Variantes

- **Texto fromMe=true** (testar guardrail): adiciona `fromMe: true` no body
- **Áudio com URL `.enc`**: testa o caminho de decryption via UAZAPI `/message/download`
- **Imagem**: `messageType: 'ImageMessage'`, `mediaType: 'image'`, `type: 'media'`, `content: { URL, mimetype: 'image/jpeg', caption: '...', width, height, fileLength }`
- **Reaction (esperar `type=other`)**: `messageType: 'ReactionMessage'`, sem content
