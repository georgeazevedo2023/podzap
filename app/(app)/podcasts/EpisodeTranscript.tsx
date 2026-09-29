'use client';

/**
 * `EpisodeTranscript` — transcrição do card de podcast com edição inline.
 *
 * "editar" abre um textarea com o roteiro; "salvar e gerar áudio" chama
 * `POST /api/summaries/[id]/regenerate-audio`, que grava o texto, apaga o
 * áudio antigo e reenfileira o TTS. Enquanto o card não tem áudio
 * (`hasAudio=false`), a página é revalidada a cada POLL_MS pra o player
 * novo aparecer sozinho. Nada é enviado ao grupo — entrega segue manual.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 8_000;
const POLL_MAX_MS = 5 * 60_000;

export interface EpisodeTranscriptProps {
  summaryId: string;
  text: string;
  hasAudio: boolean;
}

export function EpisodeTranscript({
  summaryId,
  text,
  hasAudio,
}: EpisodeTranscriptProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // Aguarda o worker TTS: revalida a página até o áudio novo existir.
  useEffect(() => {
    if (!waiting) return;
    if (hasAudio) {
      setWaiting(false);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        clearInterval(timer);
        setWaiting(false);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, hasAudio, router]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/summaries/${summaryId}/regenerate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      setWaiting(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        border: '2px solid var(--stroke)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-1)',
        padding: '10px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            userSelect: 'none',
          }}
        >
          {open ? '▾' : '▸'} 📝 transcrição
        </button>
        {!editing && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setDraft(text);
              setOpen(true);
              setEditing(true);
              setError(null);
            }}
          >
            ✏️ editar
          </button>
        )}
      </div>

      {waiting && (
        <p
          role="status"
          style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-dim)' }}
        >
          🎙️ gerando o áudio novo… o player aparece aqui sozinho em 1-2 min.
        </p>
      )}

      {editing ? (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            aria-label="Editar transcrição"
            style={{
              width: '100%',
              resize: 'vertical',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              lineHeight: 1.5,
              padding: 10,
              borderRadius: 'var(--r-md)',
              border: '2px solid var(--stroke)',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)' }}>
            Mantenha os prefixos <code>Ana:</code> / <code>Beto:</code> no
            início de cada fala. Marcações como <code>(rindo)</code> viram
            entonação, não são lidas.
          </p>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--red-500)' }}>
              ✗ {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-purple btn-xs"
              onClick={save}
              disabled={saving || draft.trim().length === 0}
            >
              {saving ? 'salvando…' : '🔄 salvar e gerar áudio'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
            >
              cancelar
            </button>
          </div>
        </div>
      ) : (
        open && (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {text}
          </p>
        )
      )}
    </div>
  );
}

export default EpisodeTranscript;
