// TODO: install zod — `npm i zod`
//
// Types + runtime schemas for the UAZAPI integration layer.
//
// Design notes:
//   - We export both the zod schema and the inferred TS type for every shape.
//     Schemas are used to validate webhook payloads and (optionally) responses;
//     types are used in the client surface.
//   - UAZAPI returns inconsistent field casing (PascalCase / camelCase).
//     Incoming schemas use `z.preprocess` to normalise before parsing.
//   - For unknown / future message types we land on a `kind: "other"` variant
//     rather than failing the webhook — the handler must never throw on shape.

import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────
//  Instance
// ──────────────────────────────────────────────────────────────────────────

export const InstanceStatusSchema = z.enum([
  "connected",
  "connecting",
  "disconnected",
  "qr",          // QR displayed, awaiting scan
  "unknown",
]);
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

/**
 * Live shape (from `/instance/init` and `/instance/all` on wsmart.uazapi.com):
 *   {
 *     id, token, status, paircode, qrcode, name, profileName, profilePicUrl,
 *     isBusiness, plataform, systemName, owner, current_presence,
 *     lastDisconnect, lastDisconnectReason, adminField01, adminField02,
 *     openai_apikey, chatbot_enabled, chatbot_ignoreGroups,
 *     chatbot_stopConversation, chatbot_stopMinutes,
 *     chatbot_stopWhenYouSendMsg, created, updated, currentTime,
 *     msg_delay_min, msg_delay_max
 *   }
 * We only surface the subset our app needs; extra fields are ignored
 * (Zod's default — it doesn't fail on unknown keys).
 */
export const InstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  status: InstanceStatusSchema.default("unknown"),
  /** Primary WhatsApp JID once connected (e.g. "5511…@s.whatsapp.net"). */
  owner: z.string().optional(),
  profileName: z.string().optional(),
  profilePicUrl: z.string().url().optional().or(z.literal("")),
  isBusiness: z.boolean().optional(),
  /** Device platform label from UAZAPI (e.g. "android", "smba", ""). */
  plataform: z.string().optional(),
  lastDisconnect: z.string().optional(),
  lastDisconnectReason: z.string().optional(),
});
export type Instance = z.infer<typeof InstanceSchema>;

export const CreateInstanceRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateInstanceRequest = z.infer<typeof CreateInstanceRequestSchema>;

/**
 * Live envelope from `POST /instance/init`:
 *   {
 *     info, instance: { ...InstanceSchema }, name, response, status: {...},
 *     token: "<instance-token>"
 *   }
 * We unwrap `instance` and let Zod strip the rest.
 */
export const CreateInstanceResponseSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && "instance" in raw) {
      return (raw as { instance: unknown }).instance;
    }
    return raw;
  },
  InstanceSchema,
);
export type CreateInstanceResponse = z.infer<typeof CreateInstanceResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────
//  Webhook config (stored server-side on the instance)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Shape observed from `POST /webhook` (and `GET /webhook`):
 *   [{ id, url, events: string[], enabled: boolean,
 *      addUrlEvents: boolean, addUrlTypesMessages: boolean,
 *      excludeMessages: string[] }]
 */
export const WebhookConfigSchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  events: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  addUrlEvents: z.boolean().optional(),
  addUrlTypesMessages: z.boolean().optional(),
  excludeMessages: z.array(z.string()).optional(),
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/** The endpoint always returns an array, even when only one is configured. */
export const WebhookListSchema = z.preprocess(
  (raw) => (Array.isArray(raw) ? raw : raw ? [raw] : []),
  z.array(WebhookConfigSchema),
);
export type WebhookList = z.infer<typeof WebhookListSchema>;

export const QrCodeResponseSchema = z.object({
  qrCodeBase64: z.string(),           // data-URL-ready base64 (no prefix)
  status: InstanceStatusSchema.optional(),
});
export type QrCodeResponse = z.infer<typeof QrCodeResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────
//  Groups
// ──────────────────────────────────────────────────────────────────────────

/** Normalise a participant object whose keys may be Pascal or camel case. */
const normaliseParticipant = (p: unknown): unknown => {
  if (!p || typeof p !== "object") return p;
  const src = p as Record<string, unknown>;
  return {
    jid:           src.jid          ?? src.JID          ?? src.id,
    pushName:      src.pushName     ?? src.PushName     ?? src.name,
    phoneNumber:   src.phoneNumber  ?? src.PhoneNumber,
    isAdmin:       src.isAdmin      ?? src.IsAdmin      ?? false,
    isSuperAdmin:  src.isSuperAdmin ?? src.IsSuperAdmin ?? false,
  };
};

export const GroupMemberSchema = z.preprocess(
  normaliseParticipant,
  z.object({
    jid: z.string(),
    pushName: z.string().optional(),
    phoneNumber: z.string().optional(),
    isAdmin: z.boolean().default(false),
    isSuperAdmin: z.boolean().default(false),
  }),
);
export type GroupMember = z.infer<typeof GroupMemberSchema>;

const normaliseGroup = (g: unknown): unknown => {
  if (!g || typeof g !== "object") return g;
  const src = g as Record<string, unknown>;
  return {
    jid:           src.jid     ?? src.JID     ?? src.id,
    name:          src.name    ?? src.Name    ?? src.subject ?? src.Subject,
    size:          src.size    ?? src.Size    ?? (Array.isArray(src.Participants) ? (src.Participants as unknown[]).length : undefined),
    pictureUrl:    src.pictureUrl ?? src.profilePicUrl,
    participants:  src.participants ?? src.Participants ?? [],
  };
};

export const GroupSchema = z.preprocess(
  normaliseGroup,
  z.object({
    jid: z.string(),                 // "<id>@g.us"
    name: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    pictureUrl: z.string().url().optional(),
    participants: z.array(GroupMemberSchema).default([]),
  }),
);
export type Group = z.infer<typeof GroupSchema>;

export const ListGroupsResponseSchema = z.preprocess(
  (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      return r.groups ?? r.data ?? r.results ?? [];
    }
    return [];
  },
  z.array(GroupSchema),
);
export type ListGroupsResponse = z.infer<typeof ListGroupsResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────
//  Outgoing messages
// ──────────────────────────────────────────────────────────────────────────

/** A WhatsApp destination — either a raw phone (E.164 digits) or a full JID. */
export const DestinationSchema = z.string().min(5);
export type Destination = z.infer<typeof DestinationSchema>;

export const SendTextRequestSchema = z.object({
  number: DestinationSchema,
  text: z.string().min(1).max(4096),
});
export type SendTextRequest = z.infer<typeof SendTextRequestSchema>;

/**
 * Audio variants:
 *  - `ptt`: push-to-talk / voice note (waveform UI). Prefer OGG/Opus.
 *  - `audio`: regular audio file attachment (MP3 works here).
 */
export const AudioKindSchema = z.enum(["ptt", "audio"]);
export type AudioKind = z.infer<typeof AudioKindSchema>;

export const SendAudioRequestSchema = z.object({
  number: DestinationSchema,
  /** Either a public https URL or a raw base64 (data URL prefix optional). */
  file: z.string().min(1),
  kind: AudioKindSchema.default("ptt"),
  /** Most clients ignore caption for ptt; included for media-audio parity. */
  text: z.string().max(4096).optional(),
});
export type SendAudioRequest = z.infer<typeof SendAudioRequestSchema>;

/** Discriminated union for everything the client can send. */
export const OutgoingMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"),  payload: SendTextRequestSchema  }),
  z.object({ kind: z.literal("audio"), payload: SendAudioRequestSchema }),
]);
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;

export const SendMessageResponseSchema = z.object({
  id: z.string().optional(),          // WhatsApp message id, when returned
  status: z.string().optional(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// ──────────────────────────────────────────────────────────────────────────
//  Incoming webhooks
// ──────────────────────────────────────────────────────────────────────────

export const MessageKeySchema = z.object({
  id: z.string(),
  remoteJid: z.string(),
  fromMe: z.boolean().default(false),
  participant: z.string().optional(),
});
export type MessageKey = z.infer<typeof MessageKeySchema>;

// ── Per-content payloads ────────────────────────────────────────────────

const TextContentSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
});

const AudioContentSchema = z.object({
  kind: z.literal("audio"),
  mimetype: z.string().optional(),
  seconds: z.number().int().nonnegative().optional(),
  ptt: z.boolean().default(false),
  mediaUrl: z.string().optional(),
  fileLength: z.number().int().nonnegative().optional(),
});

const ImageContentSchema = z.object({
  kind: z.literal("image"),
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  mediaUrl: z.string().optional(),
  fileLength: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const VideoContentSchema = z.object({
  kind: z.literal("video"),
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  seconds: z.number().int().nonnegative().optional(),
  mediaUrl: z.string().optional(),
  fileLength: z.number().int().nonnegative().optional(),
});

const OtherContentSchema = z.object({
  kind: z.literal("other"),
  /** Original `messageType` string from UAZAPI (documentMessage, stickerMessage, etc.). */
  rawType: z.string().optional(),
});

export const MessageContentSchema = z.discriminatedUnion("kind", [
  TextContentSchema,
  AudioContentSchema,
  ImageContentSchema,
  VideoContentSchema,
  OtherContentSchema,
]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

/**
 * Normalise the raw `data` block of a UAZAPI `messages.upsert` into our
 * internal `MessageContent`. Unknown types degrade gracefully to `other`.
 */
const normaliseMessageContent = (data: unknown): MessageContent => {
  if (!data || typeof data !== "object") return { kind: "other" };
  const d = data as Record<string, unknown>;
  const msg = (d.message ?? {}) as Record<string, unknown>;
  const rawType = (d.messageType ?? "") as string;

  if (typeof msg.conversation === "string" || rawType === "conversation") {
    return { kind: "text", text: (msg.conversation as string) ?? "" };
  }
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage === "object") {
    const e = msg.extendedTextMessage as Record<string, unknown>;
    return { kind: "text", text: (e.text as string) ?? "" };
  }
  if (msg.audioMessage) {
    const a = msg.audioMessage as Record<string, unknown>;
    return {
      kind: "audio",
      mimetype: a.mimetype as string | undefined,
      seconds: a.seconds as number | undefined,
      ptt: Boolean(a.ptt),
      mediaUrl: a.url as string | undefined,
      fileLength: a.fileLength as number | undefined,
    };
  }
  if (msg.imageMessage) {
    const i = msg.imageMessage as Record<string, unknown>;
    return {
      kind: "image",
      mimetype: i.mimetype as string | undefined,
      caption: i.caption as string | undefined,
      mediaUrl: i.url as string | undefined,
      fileLength: i.fileLength as number | undefined,
      width: i.width as number | undefined,
      height: i.height as number | undefined,
    };
  }
  if (msg.videoMessage) {
    const v = msg.videoMessage as Record<string, unknown>;
    return {
      kind: "video",
      mimetype: v.mimetype as string | undefined,
      caption: v.caption as string | undefined,
      seconds: v.seconds as number | undefined,
      mediaUrl: v.url as string | undefined,
      fileLength: v.fileLength as number | undefined,
    };
  }
  return { kind: "other", rawType };
};

// ── Discriminated union of webhook events ───────────────────────────────

export const MessageUpsertEventSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const data = (r.data ?? {}) as Record<string, unknown>;
    return {
      event: "message" as const,
      instance: (r.instance ?? r.instanceId ?? "") as string,
      key: data.key,
      pushName: data.pushName,
      timestamp:
        typeof data.messageTimestamp === "number"
          ? (data.messageTimestamp > 9_999_999_999
              ? (data.messageTimestamp as number)
              : (data.messageTimestamp as number) * 1000)
          : undefined,
      content: normaliseMessageContent(data),
    };
  },
  z.object({
    event: z.literal("message"),
    instance: z.string(),
    key: MessageKeySchema,
    pushName: z.string().optional(),
    timestamp: z.number().int().optional(),            // ms since epoch
    content: MessageContentSchema,
  }),
);
export type MessageUpsertEvent = z.infer<typeof MessageUpsertEventSchema>;

export const ConnectionUpdateEventSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const data = (r.data ?? {}) as Record<string, unknown>;
    return {
      event: "connection" as const,
      instance: (r.instance ?? r.instanceId ?? "") as string,
      status: (data.status ?? "unknown") as string,
      loggedIn: Boolean(data.loggedIn),
      reason: data.reason as string | undefined,
    };
  },
  z.object({
    event: z.literal("connection"),
    instance: z.string(),
    status: InstanceStatusSchema,
    loggedIn: z.boolean().default(false),
    reason: z.string().optional(),
  }),
);
export type ConnectionUpdateEvent = z.infer<typeof ConnectionUpdateEventSchema>;

/**
 * Top-level router: pick the right normaliser by looking at the UAZAPI
 * `event` field (`messages.upsert`, `connection.update`, ...).
 *
 * Unknown events are preserved as `{ event: "unknown", raw }` so the webhook
 * handler can log without throwing.
 */
export const IncomingWebhookEventSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    const ev = (r.event ?? r.type ?? "") as string;
    if (ev.startsWith("messages") || ev === "message" || ev === "messages.upsert") {
      return raw;                                // MessageUpsertEventSchema handles it
    }
    if (ev.startsWith("connection") || ev === "connection.update") {
      return raw;
    }
    return { event: "unknown", raw };
  },
  z.union([
    MessageUpsertEventSchema,
    ConnectionUpdateEventSchema,
    z.object({ event: z.literal("unknown"), raw: z.unknown() }),
  ]),
);
export type IncomingWebhookEvent = z.infer<typeof IncomingWebhookEventSchema>;

// ──────────────────────────────────────────────────────────────────────────
//  Errors
// ──────────────────────────────────────────────────────────────────────────

export interface UazapiErrorShape {
  status: number;
  code?: string;
  message: string;
  /** Raw response body for debugging. */
  body?: unknown;
}

export class UazapiError extends Error implements UazapiErrorShape {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor({ status, code, message, body }: UazapiErrorShape) {
    super(message);
    this.name = "UazapiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
