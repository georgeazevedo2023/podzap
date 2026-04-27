/**
 * GET /api/groups/music — lista pública de tracks ativas pra picker
 * dos grupos. Tenant-scoped (qualquer user logado, mesmo sem
 * superadmin) — o catálogo é global.
 *
 * Response: `200 { tracks: PublicMusicTrack[] }`
 */

import { NextResponse } from "next/server";

import { listActiveTracks, MusicAdminError } from "@/lib/admin/music";
import { requireAuth } from "@/app/api/whatsapp/_shared";

export async function GET() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;

  try {
    const tracks = await listActiveTracks();
    return NextResponse.json({ tracks });
  } catch (err) {
    if (err instanceof MusicAdminError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "erro inesperado" } },
      { status: 500 },
    );
  }
}
