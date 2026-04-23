'use client';

import { useMemo, useState } from 'react';

import type { Database } from '@/lib/supabase/types';

type MessageType = Database['public']['Enums']['message_type'];

/**
 * Flat, UI-ready shape for a single message row. Server component resolves
 * the media signed URL up-front so the client never needs service-role
 * credentials and we don't pay a round-trip per audio tag.
 */
export interface HistoryItem {
  id: string;
  capturedAt: string;
  type: MessageType;
  content: string | null;
  senderName: string | null;
  senderJid: string | null;
  groupName: string;
  groupPictureUrl: string | null;
  mediaMimeType: string | null;
  mediaDurationSeconds: number | null;
  /** Pre-signed storage URL; `null` when no media or signing failed. */
  mediaSignedUrl: string | null;
}

export interface MessagesListProps {
  initial: HistoryItem[];
}

/**
 * Renders the chronological feed. Keeps state minimal — the refresh button
 * at the top of the page simply calls `router.refresh()` to re-run the server
 * component, so we don't need polling or SWR for Fase 4. The image lightbox
 * is the only piece of genuinely client-only state.
 */
export function MessagesList({ initial }: MessagesListProps) {
  const [lightbox, setLightbox] = useState<HistoryItem | null>(null);

  const count = initial.length;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span className="sticker sticker-purple">
          🎧 {count} mensagens
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-dim)',
            fontWeight: 600,
          }}
        >
          mais recentes primeiro · até 50 últimas
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {initial.map((item) => (
          <MessageRow
            key={item.id}
            item={item}
            onOpenImage={() => setLightbox(item)}
          />
        ))}
      </div>

      {lightbox && lightbox.mediaSignedUrl && (
        <ImageLightbox
          src={lightbox.mediaSignedUrl}
          alt={lightbox.content ?? lightbox.groupName}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

export default MessagesList;

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

interface MessageRowProps {
  item: HistoryItem;
  onOpenImage: () => void;
}

function MessageRow({ item, onOpenImage }: MessageRowProps) {
  const relativeTime = useRelativeTime(item.capturedAt);

  return (
    <article
      className="card"
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: '48px minmax(0, 1fr)',
        gap: 14,
        alignItems: 'flex-start',
      }}
    >
      <GroupAvatar name={item.groupName} pictureUrl={item.groupPictureUrl} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: '-0.01em',
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
            title={item.groupName}
          >
            {item.groupName}
          </span>
          <TypeBadge type={item.type} />
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)',
              fontWeight: 600,
            }}
            title={new Date(item.capturedAt).toLocaleString('pt-BR')}
          >
            {relativeTime}
          </span>
        </header>

        {item.senderName && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-dim)',
            }}
          >
            {item.senderName}
          </div>
        )}

        <MessageBody item={item} onOpenImage={onOpenImage} />
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Body per type                                                              */
/* -------------------------------------------------------------------------- */

function MessageBody({
  item,
  onOpenImage,
}: {
  item: HistoryItem;
  onOpenImage: () => void;
}) {
  if (item.type === 'audio') {
    if (!item.mediaSignedUrl) {
      return <MediaPending label="áudio sendo processado…" />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <audio
          controls
          preload="none"
          src={item.mediaSignedUrl}
          style={{ width: '100%', maxWidth: 420 }}
        >
          <track kind="captions" />
        </audio>
        {item.mediaDurationSeconds ? (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {formatDuration(item.mediaDurationSeconds)}
          </span>
        ) : null}
      </div>
    );
  }

  if (item.type === 'image') {
    if (!item.mediaSignedUrl) {
      return <MediaPending label="imagem sendo baixada…" />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          onClick={onOpenImage}
          style={{
            padding: 0,
            border: '2px solid var(--stroke)',
            borderRadius: 'var(--r-md)',
            background: 'var(--bg-2)',
            cursor: 'zoom-in',
            overflow: 'hidden',
            alignSelf: 'flex-start',
            maxWidth: '100%',
          }}
          aria-label="Abrir imagem em tela cheia"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.mediaSignedUrl}
            alt={item.content ?? 'imagem recebida'}
            loading="lazy"
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 280,
              objectFit: 'cover',
            }}
          />
        </button>
        {item.content && (
          <span
            style={{
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.4,
            }}
          >
            {truncate(item.content, 240)}
          </span>
        )}
      </div>
    );
  }

  // text / video / other — show content (truncated) with a subtle tag for
  // unsupported types so the user knows the pipeline saw something.
  const body = item.content ?? (item.type === 'text' ? '' : `(${item.type})`);
  return (
    <p
      style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.45,
        color: 'var(--text)',
        wordBreak: 'break-word',
      }}
    >
      {truncate(body, 420) || (
        <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
          (sem texto)
        </span>
      )}
    </p>
  );
}

function MediaPending({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--text-dim)',
        fontStyle: 'italic',
        padding: '8px 12px',
        border: '2px dashed var(--stroke)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-2)',
        alignSelf: 'flex-start',
      }}
    >
      ⏳ {label}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function GroupAvatar({
  name,
  pictureUrl,
}: {
  name: string;
  pictureUrl: string | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      aria-hidden
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        border: '2.5px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
        background: 'var(--purple-600)',
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        fontFamily: 'var(--font-brand)',
        fontSize: 18,
        flexShrink: 0,
      }}
    >
      {pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pictureUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initial
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: MessageType }) {
  const meta: Record<
    MessageType,
    { label: string; icon: string; bg: string; fg: string }
  > = {
    text: {
      label: 'texto',
      icon: '💬',
      bg: 'var(--bg-2)',
      fg: 'var(--text)',
    },
    audio: {
      label: 'áudio',
      icon: '🎤',
      bg: 'var(--pink-500)',
      fg: '#fff',
    },
    image: {
      label: 'imagem',
      icon: '🖼',
      bg: 'var(--yellow-500)',
      fg: 'var(--ink-900)',
    },
    video: {
      label: 'vídeo',
      icon: '🎬',
      bg: 'var(--purple-600)',
      fg: '#fff',
    },
    other: {
      label: 'outro',
      icon: '📎',
      bg: 'var(--bg-2)',
      fg: 'var(--text-dim)',
    },
  };
  const m = meta[type];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: m.bg,
        color: m.fg,
        border: '2px solid var(--stroke)',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagem ampliada"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
        cursor: 'zoom-out',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          border: '3px solid var(--stroke)',
          borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-chunk-lg)',
          background: '#fff',
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Poor-man's relative timestamp. Stable across renders because we derive it
 * from the ISO string at mount — no ticker, no re-renders. Good enough for
 * a "recent activity" feed that the user refreshes manually.
 */
function useRelativeTime(iso: string): string {
  return useMemo(() => formatRelative(iso), [iso]);
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 45) return 'agora';
  if (diffSec < 90) return 'há 1 min';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `há ${diffD} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
