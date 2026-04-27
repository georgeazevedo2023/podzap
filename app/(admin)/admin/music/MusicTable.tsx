'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';

import {
  AdminEntityList,
  type AdminColumn,
} from '@/components/admin/AdminEntityList';
import type { MusicTrackAdminView } from '@/lib/admin/music';

import {
  fieldLabel,
  FormError,
  inputStyle,
  ModalFooter,
  ModalShell,
} from '../tenants/TenantsTable';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type ModalState =
  | { kind: 'upload' }
  | { kind: 'edit'; track: MusicTrackAdminView }
  | { kind: 'delete'; track: MusicTrackAdminView }
  | null;

export function MusicTable({ tracks }: { tracks: MusicTrackAdminView[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function patchTrack(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    setFlash(null);
    try {
      const res = await fetch(`/api/admin/music/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? `falha (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTrack(id: string) {
    setBusyId(id);
    setFlash(null);
    try {
      const res = await fetch(`/api/admin/music/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? `falha (${res.status})`);
      }
      setModal(null);
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  const columns: AdminColumn<MusicTrackAdminView>[] = [
    {
      key: 'emoji',
      label: '',
      render: (t) => (
        <span style={{ fontSize: 22 }} aria-hidden>
          {t.emoji}
        </span>
      ),
    },
    {
      key: 'label',
      label: 'nome',
      render: (t) => (
        <div>
          <div style={{ fontWeight: 800, color: 'var(--text)' }}>{t.label}</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              marginTop: 2,
            }}
          >
            <code style={{ fontSize: 11 }}>{t.id}</code>
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'descrição',
      mobileHide: true,
      render: (t) => (
        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          {t.description || <em style={{ opacity: 0.5 }}>(sem descrição)</em>}
        </span>
      ),
    },
    {
      key: 'kind',
      label: 'tipo',
      render: (t) => <KindBadge kind={t.kind} />,
    },
    {
      key: 'isActive',
      label: 'status',
      render: (t) => (
        <span
          style={{
            color: t.isActive ? 'var(--lime-500)' : 'var(--text-dim)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {t.isActive ? '● ativo' : '○ inativo'}
        </span>
      ),
    },
    {
      key: 'preview',
      label: 'prévia',
      render: (t) =>
        t.previewUrl ? (
          <audio
            controls
            preload="none"
            src={t.previewUrl}
            style={{ height: 32, maxWidth: 200 }}
          />
        ) : t.kind === 'sentinel' ? (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
        ) : t.builtinFilename ? (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            (arquivo local)
          </span>
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
        ),
    },
  ];

  const renderActions = (t: MusicTrackAdminView) => (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-admin-action
        disabled={busyId === t.id}
        onClick={() => setModal({ kind: 'edit', track: t })}
      >
        editar
      </button>
      {t.isMutable ? (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            data-admin-action
            disabled={busyId === t.id}
            onClick={() => patchTrack(t.id, { isActive: !t.isActive })}
          >
            {t.isActive ? 'desativar' : 'reativar'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            data-admin-action
            data-danger="true"
            disabled={busyId === t.id}
            onClick={() => setModal({ kind: 'delete', track: t })}
          >
            deletar
          </button>
        </>
      ) : (
        <span
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            paddingLeft: 8,
          }}
          title="Tracks builtin/sentinel não podem ser desativadas ou deletadas — são fallback do mixer."
        >
          🔒 imutável
        </span>
      )}
    </>
  );

  const uploadCount = tracks.filter((t) => t.kind === 'upload').length;

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {tracks.length} track{tracks.length === 1 ? '' : 's'} ·{' '}
          {uploadCount} upload{uploadCount === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          className="btn btn-zap"
          onClick={() => setModal({ kind: 'upload' })}
        >
          + nova música
        </button>
      </div>

      {flash && (
        <div
          role="alert"
          style={{
            padding: 12,
            border: '2.5px solid var(--red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--red-500)',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          ⚠ {flash}
        </div>
      )}

      <AdminEntityList<MusicTrackAdminView>
        rows={tracks}
        columns={columns}
        getRowKey={(t) => t.id}
        mobileTitle={(t) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>{t.emoji}</span>
            <strong>{t.label}</strong>
          </span>
        )}
        actions={renderActions}
        emptyState={
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--text-dim)',
            }}
          >
            nenhuma track ainda — sobe a primeira clicando em &quot;+ nova
            música&quot;.
          </div>
        }
      />

      {modal?.kind === 'upload' && (
        <UploadModal
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}

      {modal?.kind === 'edit' && (
        <EditModal
          track={modal.track}
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}

      {modal?.kind === 'delete' && (
        <DeleteConfirm
          trackLabel={modal.track.label}
          onCancel={() => setModal(null)}
          onConfirm={() => deleteTrack(modal.track.id)}
          busy={busyId === modal.track.id}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* KindBadge                                                                  */
/* -------------------------------------------------------------------------- */

function KindBadge({
  kind,
}: {
  kind: MusicTrackAdminView['kind'];
}) {
  const map = {
    sentinel: { label: 'sentinel', color: 'var(--text-dim)' },
    builtin: { label: 'builtin', color: 'var(--purple-500, #b39bff)' },
    upload: { label: 'upload', color: 'var(--lime-500)' },
  } as const;
  const { label, color } = map[kind];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        border: `2px solid ${color}`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        color,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* UploadModal                                                                */
/* -------------------------------------------------------------------------- */

function UploadModal({ onClose }: { onClose: (saved: boolean) => void }) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('🎵');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!/\.mp3$/i.test(f.name) && !/^audio\//.test(f.type)) {
      setError('arquivo precisa ser .mp3');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(
        `arquivo grande demais (${(f.size / 1024 / 1024).toFixed(1)}MB > 10MB)`,
      );
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!label.trim()) {
      setError('nome é obrigatório');
      return;
    }
    if (!file) {
      setError('escolha um arquivo .mp3');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('label', label.trim());
      if (description.trim()) form.set('description', description.trim());
      if (emoji.trim()) form.set('emoji', emoji.trim());

      const res = await fetch('/api/admin/music', {
        method: 'POST',
        body: form,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `falha (${res.status})`);
      }
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="nova música de fundo" onClose={() => onClose(false)}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {/* dropzone / picker */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files?.[0] ?? null;
            pickFile(dropped);
          }}
          role="button"
          tabIndex={0}
          aria-label="Clique ou arraste um arquivo .mp3"
          style={{
            border: '2.5px dashed var(--stroke)',
            borderRadius: 'var(--radius-md)',
            padding: 24,
            textAlign: 'center',
            cursor: 'pointer',
            background: file ? 'var(--surface)' : 'var(--bg-2)',
            transition: 'background 0.15s ease',
          }}
        >
          {file ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                📁 {file.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  marginTop: 4,
                }}
              >
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
              {previewUrl && (
                <audio
                  controls
                  src={previewUrl}
                  style={{
                    marginTop: 12,
                    width: '100%',
                    maxWidth: 320,
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 32 }}>🎵</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>
                clique ou arraste um .mp3
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  marginTop: 4,
                }}
              >
                até 10MB · royalty-free recomendado
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>nome</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={60}
            disabled={submitting}
            style={inputStyle}
            placeholder="ex.: Jazz suave"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>descrição (opcional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            disabled={submitting}
            style={inputStyle}
            placeholder="ex.: piano + saxophone, mood relaxado"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>emoji (opcional)</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            maxLength={8}
            disabled={submitting}
            style={{ ...inputStyle, maxWidth: 120 }}
            placeholder="🎷"
          />
        </label>

        {error && <FormError>{error}</FormError>}

        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={() => onClose(false)}
            disabled={submitting}
          >
            cancelar
          </button>
          <button
            type="submit"
            className="btn btn-zap"
            disabled={submitting || !file || !label.trim()}
          >
            {submitting ? '⟳ subindo...' : '✓ subir música'}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* EditModal                                                                  */
/* -------------------------------------------------------------------------- */

function EditModal({
  track,
  onClose,
}: {
  track: MusicTrackAdminView;
  onClose: (saved: boolean) => void;
}) {
  const [label, setLabel] = useState(track.label);
  const [description, setDescription] = useState(track.description);
  const [emoji, setEmoji] = useState(track.emoji);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!label.trim()) {
      setError('nome é obrigatório');
      return;
    }

    const patch: Record<string, unknown> = {};
    if (label.trim() !== track.label) patch.label = label.trim();
    if (description.trim() !== track.description)
      patch.description = description.trim();
    if (emoji.trim() && emoji.trim() !== track.emoji) patch.emoji = emoji.trim();

    if (Object.keys(patch).length === 0) {
      onClose(false);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/music/${encodeURIComponent(track.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
          cache: 'no-store',
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `falha (${res.status})`);
      }
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title={`editar ${track.label}`} onClose={() => onClose(false)}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {!track.isMutable && (
          <div
            style={{
              padding: 10,
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: 'var(--text-dim)',
              background: 'var(--bg-2)',
            }}
          >
            🔒 track {track.kind} — só metadata cosmética é editável (label/descrição/emoji).
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>id</span>
          <code
            style={{
              padding: 8,
              background: 'var(--bg-2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              color: 'var(--text-dim)',
            }}
          >
            {track.id}
          </code>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>nome</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={60}
            disabled={submitting}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>descrição</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            disabled={submitting}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>emoji</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            maxLength={8}
            disabled={submitting}
            style={{ ...inputStyle, maxWidth: 120 }}
          />
        </label>

        {track.previewUrl && (
          <audio
            controls
            src={track.previewUrl}
            style={{ width: '100%', maxWidth: 320 }}
          />
        )}

        {error && <FormError>{error}</FormError>}

        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={() => onClose(false)}
            disabled={submitting}
          >
            cancelar
          </button>
          <button type="submit" className="btn btn-zap" disabled={submitting}>
            {submitting ? '⟳ salvando...' : '✓ salvar'}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* DeleteConfirm                                                              */
/* -------------------------------------------------------------------------- */

function DeleteConfirm({
  trackLabel,
  onCancel,
  onConfirm,
  busy,
}: {
  trackLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <ModalShell title="deletar música?" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            padding: 14,
            border: '2.5px solid var(--red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--text)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--red-500)' }}>
            ⚠ ação irreversível.
          </strong>
          <div style={{ marginTop: 6 }}>
            vai apagar <code>{trackLabel}</code> + o arquivo no Storage. Grupos
            que apontavam pra esta track continuam funcionando — vão cair no
            fallback &quot;default&quot; silenciosamente.
          </div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            se só quer esconder do picker, use <strong>desativar</strong>.
          </div>
        </div>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={onCancel}
            disabled={busy}
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn"
            style={{
              background: 'var(--red-500)',
              color: '#fff',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? '⟳ deletando...' : '🗑 deletar'}
          </button>
        </ModalFooter>
      </div>
    </ModalShell>
  );
}
