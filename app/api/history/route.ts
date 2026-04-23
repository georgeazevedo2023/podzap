/**
 * GET /api/history
 *
 * Returns the latest 50 captured messages for the current tenant, joined with
 * the group they belong to, with signed URLs resolved for any media rows.
 *
 * The `/history` page uses `router.refresh()` for its "atualizar" button, so
 * in practice the server component is authoritative. This endpoint exists
 * for future client-side polling and for external dashboards that want a
 * JSON feed without re-implementing the join + signing logic.
 *
 * Reply: `200 { items: HistoryApiItem[] }` (auth required)
 */

import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSignedUrl } from '@/lib/media/signedUrl';
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from '../whatsapp/_shared';

const HISTORY_LIMIT = 50;

export interface HistoryApiTranscript {
  text: string;
  language: string | null;
  model: string | null;
  createdAt: string;
}

export interface HistoryApiItem {
  id: string;
  capturedAt: string;
  type: 'text' | 'audio' | 'image' | 'video' | 'other';
  content: string | null;
  senderName: string | null;
  senderJid: string | null;
  groupName: string;
  groupPictureUrl: string | null;
  mediaMimeType: string | null;
  mediaDurationSeconds: number | null;
  mediaSignedUrl: string | null;
  /** Transcription row (Fase 5); `null` when the worker hasn't produced one
   *  yet. Audio → Whisper transcript, image → Gemini Vision description. */
  transcript: HistoryApiTranscript | null;
}

export async function GET() {
  const auth = await requireAuth();
  if ('response' in auth) return auth.response;

  const { tenant } = auth;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('messages')
      .select(
        `
        id,
        tenant_id,
        group_id,
        captured_at,
        sender_name,
        sender_jid,
        type,
        content,
        media_storage_path,
        media_mime_type,
        media_duration_seconds,
        groups:group_id ( name, picture_url ),
        transcripts ( text, language, model, created_at )
        `,
      )
      .eq('tenant_id', tenant.id)
      .order('captured_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) {
      return errorResponse(500, 'INTERNAL_ERROR', error.message);
    }

    const items: HistoryApiItem[] = await Promise.all(
      (data ?? []).map(async (row) => {
        const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
        const transcriptRow = Array.isArray(row.transcripts)
          ? row.transcripts[0]
          : row.transcripts;
        const transcript: HistoryApiTranscript | null = transcriptRow
          ? {
              text: transcriptRow.text,
              language: transcriptRow.language ?? null,
              model: transcriptRow.model ?? null,
              createdAt: transcriptRow.created_at,
            }
          : null;
        let mediaSignedUrl: string | null = null;
        if (row.media_storage_path) {
          try {
            mediaSignedUrl = await getSignedUrl(row.media_storage_path);
          } catch {
            mediaSignedUrl = null;
          }
        }
        return {
          id: row.id,
          capturedAt: row.captured_at,
          type: row.type,
          content: row.content,
          senderName: row.sender_name ?? null,
          senderJid: row.sender_jid ?? null,
          groupName: group?.name ?? 'grupo sem nome',
          groupPictureUrl: group?.picture_url ?? null,
          mediaMimeType: row.media_mime_type ?? null,
          mediaDurationSeconds: row.media_duration_seconds ?? null,
          mediaSignedUrl,
          transcript,
        };
      }),
    );

    return NextResponse.json(
      { items },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
