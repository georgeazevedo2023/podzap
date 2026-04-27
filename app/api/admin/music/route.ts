/**
 * GET  /api/admin/music — lista todas as tracks (cross-tenant, superadmin).
 * POST /api/admin/music — sobe track nova (multipart: file + metadata).
 */

import { NextResponse } from "next/server";

import {
  createTrack,
  listAllTracks,
  MusicAdminError,
} from "@/lib/admin/music";
import {
  mapErrorToResponse,
  requireSuperadminJson,
} from "../_shared";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/x-mpeg",
  "audio/mpeg3",
]);

export async function GET() {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  try {
    const tracks = await listAllTracks();
    return NextResponse.json({ tracks });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return mapErrorToResponse(
      new MusicAdminError(
        "INVALID_INPUT",
        `Body inválido — esperando multipart/form-data: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  const file = form.get("file");
  const label = form.get("label");
  const description = form.get("description");
  const emoji = form.get("emoji");

  if (!(file instanceof File)) {
    return mapErrorToResponse(
      new MusicAdminError("INVALID_INPUT", "campo `file` ausente"),
    );
  }
  if (typeof label !== "string" || label.trim().length < 2) {
    return mapErrorToResponse(
      new MusicAdminError("INVALID_INPUT", "campo `label` ausente ou muito curto"),
    );
  }
  if (file.size === 0) {
    return mapErrorToResponse(
      new MusicAdminError("INVALID_INPUT", "arquivo vazio"),
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return mapErrorToResponse(
      new MusicAdminError(
        "INVALID_INPUT",
        `arquivo grande demais (máx ${MAX_FILE_BYTES / 1024 / 1024}MB)`,
      ),
    );
  }
  const contentType = (file.type || "audio/mpeg").toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return mapErrorToResponse(
      new MusicAdminError(
        "INVALID_INPUT",
        `tipo "${contentType}" não suportado — só audio/mpeg (.mp3)`,
      ),
    );
  }

  try {
    const buf = await file.arrayBuffer();
    const track = await createTrack({
      label,
      description: typeof description === "string" ? description : undefined,
      emoji: typeof emoji === "string" ? emoji : undefined,
      fileBytes: buf,
      contentType,
      sizeBytes: file.size,
    });
    return NextResponse.json({ track }, { status: 201 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
