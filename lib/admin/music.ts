/**
 * Admin service para o catálogo `music_tracks`. Cross-tenant —
 * tracks são globais (todo tenant vê o mesmo catálogo). API rotas em
 * `/api/admin/music/*` chamam aqui.
 *
 * Storage:
 *   - Uploads vão pro bucket `music` (criado por
 *     scripts/create-music-bucket.mjs). Path no bucket =
 *     `uploads/<id>.mp3` — ID único é a PK da tabela, garante uniqueness
 *     sem prefixo de tenant.
 *   - Builtins (id='default') ficam em `assets/<filename>` baked na
 *     image Docker; admin não pode mexer (UI esconde edit/delete).
 *   - Sentinel ('none') também é imutável.
 *
 * Erros: `MusicAdminError` com code enum pra mapeamento HTTP.
 */

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "music";
const SIGNED_URL_TTL_SEC = 3600; // 1h — UI lista pode caching pra preview

export type MusicTrackKind = "sentinel" | "builtin" | "upload";

export type MusicTrackAdminView = {
  id: string;
  label: string;
  description: string;
  emoji: string;
  storagePath: string | null;
  builtinFilename: string | null;
  isActive: boolean;
  sortOrder: number;
  kind: MusicTrackKind;
  /** Mutável só pelo superadmin (uploads). Builtin/sentinel são read-only. */
  isMutable: boolean;
  /** Signed URL pra preview, populada pra rows com storage_path. */
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export class MusicAdminError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "ALREADY_EXISTS"
      | "INVALID_INPUT"
      | "IMMUTABLE_TRACK"
      | "STORAGE_ERROR"
      | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "MusicAdminError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

type TrackRow = {
  id: string;
  label: string;
  description: string;
  emoji: string;
  storage_path: string | null;
  builtin_filename: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function trackKind(row: TrackRow): MusicTrackKind {
  if (row.id === "none") return "sentinel";
  if (row.builtin_filename) return "builtin";
  return "upload";
}

function isMutableRow(row: TrackRow): boolean {
  // Sentinel + builtins (default e os 4 placeholders 0021) são imutáveis
  // pra preservar IDs estáveis pros groups que já apontam pra eles.
  return trackKind(row) === "upload";
}

const SLUG_RE = /[^a-z0-9]+/g;

/**
 * Slugify pra gerar ID a partir do label. Min 2 chars, max 32. Adiciona
 * sufixo random se colide com row existente. ID estável é importante:
 * `groups.background_music` armazena ele direto sem FK.
 */
export function slugifyLabel(label: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "")
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (base.length < 2) return `track-${randomBytes(3).toString("hex")}`;
  return base;
}

async function ensureUniqueId(
  admin: ReturnType<typeof createAdminClient>,
  base: string,
): Promise<string> {
  let id = base;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await admin
      .from("music_tracks")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new MusicAdminError(
        "DB_ERROR",
        `Failed to check id uniqueness: ${error.message}`,
        error,
      );
    }
    if (!data) return id;
    id = `${base}-${randomBytes(2).toString("hex")}`;
  }
  throw new MusicAdminError(
    "ALREADY_EXISTS",
    `Could not find a unique id derived from "${base}" after 8 attempts`,
  );
}

async function rowToView(
  admin: ReturnType<typeof createAdminClient>,
  row: TrackRow,
): Promise<MusicTrackAdminView> {
  const kind = trackKind(row);
  let previewUrl: string | null = null;
  if (row.storage_path) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC);
    if (!error && data) previewUrl = data.signedUrl;
  }
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    emoji: row.emoji,
    storagePath: row.storage_path,
    builtinFilename: row.builtin_filename,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    kind,
    isMutable: isMutableRow(row),
    previewUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Reads
// ──────────────────────────────────────────────────────────────────────────

/**
 * Lista todas as tracks (ativas e inativas). Admin UI usa esta. Para o
 * picker dos grupos (clientes), use `listActiveTracks` que filtra.
 */
export async function listAllTracks(): Promise<MusicTrackAdminView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("music_tracks")
    .select(
      "id, label, description, emoji, storage_path, builtin_filename, is_active, sort_order, created_at, updated_at",
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Failed to list music tracks: ${error.message}`,
      error,
    );
  }
  const rows = (data ?? []) as TrackRow[];
  // Signed URLs em paralelo
  return Promise.all(rows.map((r) => rowToView(admin, r)));
}

/**
 * Tracks ativas — pro picker dos grupos (`/api/groups/music`).
 * Retorna só campos públicos (sem timestamps internos).
 */
export type PublicMusicTrack = {
  id: string;
  label: string;
  description: string;
  emoji: string;
  sortOrder: number;
};

export async function listActiveTracks(): Promise<PublicMusicTrack[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("music_tracks")
    .select("id, label, description, emoji, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Failed to list active tracks: ${error.message}`,
      error,
    );
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    description: r.description as string,
    emoji: r.emoji as string,
    sortOrder: r.sort_order as number,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
//  Writes
// ──────────────────────────────────────────────────────────────────────────

export interface CreateTrackInput {
  label: string;
  description?: string;
  emoji?: string;
  /** ArrayBuffer-like — vem de FormData.get('file').arrayBuffer() */
  fileBytes: ArrayBuffer | Uint8Array;
  contentType: string;
  /** Tamanho em bytes pra registro de log (signed pelo browser, não trustado). */
  sizeBytes: number;
}

/**
 * Upload track nova. Gera ID via slug do label, sobe pro bucket,
 * insere row. Erros parciais (storage ok + DB falha) limpam o blob
 * pra não vazar lixo.
 */
export async function createTrack(
  input: CreateTrackInput,
): Promise<MusicTrackAdminView> {
  const label = input.label.trim();
  if (label.length < 2 || label.length > 60) {
    throw new MusicAdminError(
      "INVALID_INPUT",
      "label deve ter entre 2 e 60 caracteres",
    );
  }
  const description = (input.description ?? "").trim().slice(0, 240);
  const emoji = (input.emoji ?? "🎵").trim().slice(0, 8) || "🎵";

  const admin = createAdminClient();
  const baseSlug = slugifyLabel(label);
  const id = await ensureUniqueId(admin, baseSlug);
  const storagePath = `uploads/${id}.mp3`;

  // Upload primeiro — se DB insert falhar abaixo, removemos
  const bytes =
    input.fileBytes instanceof Uint8Array
      ? input.fileBytes
      : new Uint8Array(input.fileBytes);
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.contentType,
      upsert: false,
    });
  if (uploadErr) {
    throw new MusicAdminError(
      "STORAGE_ERROR",
      `Upload failed: ${uploadErr.message}`,
      uploadErr,
    );
  }

  // sort_order = max + 1 entre uploads (sentinels/builtins ficam fixos no topo)
  const { data: maxRow } = await admin
    .from("music_tracks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data: inserted, error: insertErr } = await admin
    .from("music_tracks")
    .insert({
      id,
      label,
      description,
      emoji,
      storage_path: storagePath,
      builtin_filename: null,
      is_active: true,
      sort_order: sortOrder,
    })
    .select(
      "id, label, description, emoji, storage_path, builtin_filename, is_active, sort_order, created_at, updated_at",
    )
    .maybeSingle();

  if (insertErr || !inserted) {
    // limpa orphan blob — best-effort
    try {
      await admin.storage.from(BUCKET).remove([storagePath]);
    } catch {
      /* ignore */
    }
    throw new MusicAdminError(
      "DB_ERROR",
      `Insert failed: ${insertErr?.message ?? "no row returned"}`,
      insertErr,
    );
  }

  return rowToView(admin, inserted as TrackRow);
}

export interface UpdateTrackPatch {
  label?: string;
  description?: string;
  emoji?: string;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Patch parcial. Builtins/sentinels podem editar label/description/emoji
 * (cosmetic only) mas NÃO podem ser desativados — eles são fallback do
 * resolver. UI esconde o toggle pra eles.
 */
export async function updateTrack(
  id: string,
  patch: UpdateTrackPatch,
): Promise<MusicTrackAdminView> {
  const admin = createAdminClient();
  const { data: existing, error: getErr } = await admin
    .from("music_tracks")
    .select(
      "id, label, description, emoji, storage_path, builtin_filename, is_active, sort_order, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (getErr) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Lookup failed: ${getErr.message}`,
      getErr,
    );
  }
  if (!existing) {
    throw new MusicAdminError("NOT_FOUND", `Track ${id} not found`);
  }

  const row = existing as TrackRow;
  const kind = trackKind(row);

  const update: {
    label?: string;
    description?: string;
    emoji?: string;
    is_active?: boolean;
    sort_order?: number;
    updated_at?: string;
  } = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (label.length < 2 || label.length > 60) {
      throw new MusicAdminError(
        "INVALID_INPUT",
        "label deve ter entre 2 e 60 caracteres",
      );
    }
    update.label = label;
  }
  if (patch.description !== undefined) {
    update.description = patch.description.trim().slice(0, 240);
  }
  if (patch.emoji !== undefined) {
    update.emoji = patch.emoji.trim().slice(0, 8) || "🎵";
  }
  if (patch.isActive !== undefined) {
    if (kind !== "upload" && patch.isActive === false) {
      throw new MusicAdminError(
        "IMMUTABLE_TRACK",
        `Track builtin/sentinel "${id}" não pode ser desativada`,
      );
    }
    update.is_active = patch.isActive;
  }
  if (patch.sortOrder !== undefined) {
    update.sort_order = patch.sortOrder;
  }

  if (Object.keys(update).length === 0) {
    return rowToView(admin, row);
  }
  update.updated_at = new Date().toISOString();

  const { data: updated, error: updateErr } = await admin
    .from("music_tracks")
    .update(update)
    .eq("id", id)
    .select(
      "id, label, description, emoji, storage_path, builtin_filename, is_active, sort_order, created_at, updated_at",
    )
    .maybeSingle();

  if (updateErr || !updated) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Update failed: ${updateErr?.message ?? "no row returned"}`,
      updateErr,
    );
  }
  return rowToView(admin, updated as TrackRow);
}

/**
 * Hard delete. Permitido só pra uploads (kind='upload'). Remove blob do
 * Storage E row do DB. Grupos que apontavam pra ele caem no fallback
 * 'default' do resolver silenciosamente.
 */
export async function deleteTrack(id: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing, error: getErr } = await admin
    .from("music_tracks")
    .select("id, storage_path, builtin_filename")
    .eq("id", id)
    .maybeSingle();

  if (getErr) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Lookup failed: ${getErr.message}`,
      getErr,
    );
  }
  if (!existing) {
    throw new MusicAdminError("NOT_FOUND", `Track ${id} not found`);
  }
  const row = existing as Pick<
    TrackRow,
    "id" | "storage_path" | "builtin_filename"
  >;
  const kind = trackKind(row as TrackRow);
  if (kind !== "upload") {
    throw new MusicAdminError(
      "IMMUTABLE_TRACK",
      `Track builtin/sentinel "${id}" não pode ser deletada`,
    );
  }

  if (row.storage_path) {
    const { error: removeErr } = await admin.storage
      .from(BUCKET)
      .remove([row.storage_path]);
    if (removeErr) {
      // soft-fail — row ainda vai ser deletada; blob orphan é menos pior
      // que row sem blob (resolver fallbacka pro default).
      // eslint-disable-next-line no-console
      console.warn(
        `[admin/music] Storage remove failed for ${row.storage_path}: ${removeErr.message}`,
      );
    }
  }

  const { error: delErr } = await admin
    .from("music_tracks")
    .delete()
    .eq("id", id);
  if (delErr) {
    throw new MusicAdminError(
      "DB_ERROR",
      `Delete failed: ${delErr.message}`,
      delErr,
    );
  }
}
