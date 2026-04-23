'use client';

/**
 * `SummaryEditor` — client half of `/approval/[id]`.
 *
 * Owns every piece of interactive state:
 *   - `text`           current textarea value (seeded from `initial.text`)
 *   - `dirty`          `text !== initial.text` — used to gate approve + warn on reload
 *   - `saving`         PATCH /api/summaries/[id] in flight
 *   - `approving`      POST /api/summaries/[id]/approve in flight
 *   - `rejectingMode`  inline reason input is visible
 *   - `rejectReason`   the reason input value
 *   - `rejecting`      POST /api/summaries/[id]/reject in flight
 *   - `regenTone`      selected tone in the regenerate dropdown
 *   - `regenerating`   POST /api/summaries/[id]/regenerate in flight
 *   - `toast`          non-blocking status/error banner (bottom-right)
 *
 * State machine — mutations are mutually exclusive: while any of `saving /
 * approving / rejecting / regenerating` is `true`, all action buttons
 * disable. Approve additionally requires `!dirty` (the user must save pending
 * edits first) and `status === 'pending_review'`.
 *
 * API error mapping:
 *   - 409 INVALID_STATE → "esse resumo já foi aprovado/rejeitado" (the row
 *     moved out of pending_review since this page was rendered — we keep
 *     the local UI, but disable further mutations and surface the toast so
 *     the reviewer can refresh).
 *   - 400 VALIDATION_ERROR → inline message ("motivo obrigatório" for
 *     reject with blank reason; the server's message for anything else).
 *   - any other non-2xx → toast with the server's `error.message` or a
 *     status-code fallback.
 *
 * We guard `window.beforeunload` when `dirty` so the reviewer doesn't lose
 * an in-progress edit by accidentally closing the tab.
 */

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import type { SummaryView } from '@/lib/summaries/service';

export interface SummaryEditorProps {
  initial: SummaryView;
}

/** Tones accepted by `POST /api/summaries/[id]/regenerate`. Matches the
 *  `summary_tone` enum in `lib/supabase/types.ts`. */
const TONES = [
  { value: 'formal', label: 'formal' },
  { value: 'fun', label: 'divertido' },
  { value: 'corporate', label: 'corporativo' },
] as const;
type Tone = (typeof TONES)[number]['value'];

type Toast =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

/** ms success toasts linger before auto-dismissing. Errors stick. */
const TOAST_AUTO_DISMISS_MS = 4_000;

/** Shape of `{ error: { code, message } }` envelopes returned by the API
 *  routes in this project (see `app/api/whatsapp/_shared`). */
interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export function SummaryEditor({ initial }: SummaryEditorProps) {
  const router = useRouter();

  // Snapshot the original text via `useRef` so we can diff against user
  // edits after a successful save (when we rebase `initial` by assigning
  // `baseline.current = text`). Rerenders don't re-baseline accidentally.
  const baseline = useRef<string>(initial.text);
  const [text, setText] = useState<string>(initial.text);

  const [status, setStatus] = useState<SummaryView['status']>(initial.status);

  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [rejectingMode, setRejectingMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(
    null,
  );

  const [regenTone, setRegenTone] = useState<Tone>(initial.tone);

  const [toast, setToast] = useState<Toast | null>(null);

  const dirty = text !== baseline.current;
  const busy = saving || approving || rejecting || regenerating;
  const canMutate = status === 'pending_review' && !busy;

  // Auto-dismiss success toasts only.
  useEffect(() => {
    if (!toast || toast.kind !== 'success') return;
    const handle = window.setTimeout(
      () => setToast(null),
      TOAST_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(handle);
  }, [toast]);

  // Warn before unload when there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires `returnValue` to be set to a non-empty string.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /** Parses `{ error: { code, message } }` and maps to a user-facing Toast or
   *  inline error. Returns `true` if the caller should bail out (error
   *  surfaced). */
  const mapApiError = useCallback(
    async (
      res: Response,
      opts: { onValidationInline?: (message: string) => void },
    ): Promise<{ handled: true }> => {
      const payload = (await res.json().catch(() => null)) as
        | ApiErrorEnvelope
        | null;
      const code = payload?.error?.code;
      const message = payload?.error?.message;

      if (res.status === 409 && code === 'INVALID_STATE') {
        setToast({
          kind: 'error',
          message:
            'Esse resumo já foi aprovado ou rejeitado. Atualize a página.',
        });
        // Lock further mutations — row moved out of pending_review.
        setStatus((prev) =>
          prev === 'pending_review' ? 'approved' : prev,
        );
        return { handled: true };
      }
      if (res.status === 400 && code === 'VALIDATION_ERROR') {
        const inline = message ?? 'Entrada inválida.';
        if (opts.onValidationInline) {
          opts.onValidationInline(inline);
        } else {
          setToast({ kind: 'error', message: inline });
        }
        return { handled: true };
      }
      setToast({
        kind: 'error',
        message: message ?? `Falha na requisição (${res.status}).`,
      });
      return { handled: true };
    },
    [],
  );

  // ─── Save edit (PATCH) ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canMutate || !dirty) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/summaries/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        await mapApiError(res, {});
        return;
      }
      // Success — rebaseline so `dirty` flips back to false.
      baseline.current = text;
      setToast({ kind: 'success', message: 'Salvo.' });
      // Force a server refetch so the metadata panel reflects `updated_at`.
      router.refresh();
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao salvar.',
      });
    } finally {
      setSaving(false);
    }
  }, [canMutate, dirty, initial.id, mapApiError, router, text]);

  // ─── Approve (POST /approve) ──────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!canMutate || dirty) return;
    setApproving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/summaries/${initial.id}/approve`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        await mapApiError(res, {});
        return;
      }
      router.push('/approval?status=approved');
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao aprovar.',
      });
    } finally {
      setApproving(false);
    }
  }, [canMutate, dirty, initial.id, mapApiError, router]);

  // ─── Reject (POST /reject) ────────────────────────────────────────────
  const handleRejectConfirm = useCallback(async () => {
    if (!canMutate) return;
    const trimmed = rejectReason.trim();
    if (trimmed.length === 0) {
      setRejectReasonError('motivo obrigatório');
      return;
    }
    setRejecting(true);
    setRejectReasonError(null);
    setToast(null);
    try {
      const res = await fetch(`/api/summaries/${initial.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        await mapApiError(res, {
          onValidationInline: (message) => setRejectReasonError(message),
        });
        return;
      }
      router.push('/approval?status=rejected');
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao rejeitar.',
      });
    } finally {
      setRejecting(false);
    }
  }, [canMutate, initial.id, mapApiError, rejectReason, router]);

  // ─── Regenerate (POST /regenerate { tone? }) ──────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!canMutate) return;
    setRegenerating(true);
    setToast(null);
    try {
      const res = await fetch(`/api/summaries/${initial.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ tone: regenTone }),
      });
      if (!res.ok) {
        await mapApiError(res, {});
        return;
      }
      setToast({
        kind: 'success',
        message:
          'Gerando… aparece em alguns segundos em pending_review.',
      });
      router.push('/approval?status=pending_review');
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao regenerar.',
      });
    } finally {
      setRegenerating(false);
    }
  }, [canMutate, initial.id, mapApiError, regenTone, router]);

  const approveDisabled = dirty || !canMutate;
  const saveDisabled = !canMutate || !dirty;
  const rejectConfirmDisabled =
    !canMutate || rejectReason.trim().length === 0;

  const wordCount = useMemo(
    () => text.trim().split(/\s+/).filter(Boolean).length,
    [text],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {status !== 'pending_review' && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            border: '2.5px solid var(--stroke)',
            background: 'var(--bg-2)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Este resumo já foi{' '}
          {status === 'approved' ? 'aprovado' : 'rejeitado'} — edições e
          ações estão desabilitadas.
        </div>
      )}

      <label
        htmlFor="summary-text"
        style={{
          fontSize: 11,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--text-dim)',
        }}
      >
        Roteiro — {wordCount} palavras {dirty ? '· alterado' : ''}
      </label>

      <textarea
        id="summary-text"
        aria-label="Texto do resumo"
        value={text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          setText(e.target.value)
        }
        disabled={status !== 'pending_review'}
        spellCheck
        style={{
          width: '100%',
          minHeight: 500,
          padding: 18,
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text)',
          background: 'var(--surface)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-chunk)',
          resize: 'vertical',
          outline: 'none',
        }}
      />

      {/* Toolbar — sticky at the bottom of the viewport so long texts don't
          push the actions off-screen. */}
      <div
        style={{
          position: 'sticky',
          bottom: 12,
          zIndex: 5,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: 12,
          background: 'var(--surface)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-chunk)',
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={handleSave}
          disabled={saveDisabled}
          aria-label="Salvar edição do resumo"
          style={{ opacity: saveDisabled ? 0.55 : 1 }}
        >
          {saving ? '⟳ salvando…' : '💾 salvar edição'}
        </button>

        <button
          type="button"
          className="btn btn-zap"
          onClick={handleApprove}
          disabled={approveDisabled}
          aria-label="Aprovar resumo"
          style={{ opacity: approveDisabled ? 0.55 : 1 }}
          title={
            dirty
              ? 'Salve a edição antes de aprovar'
              : status !== 'pending_review'
                ? 'Resumo não está pendente'
                : undefined
          }
        >
          {approving ? '⟳ aprovando…' : '✓ aprovar'}
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 4,
          }}
        >
          <label
            htmlFor="regen-tone"
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
            }}
          >
            tom
          </label>
          <select
            id="regen-tone"
            value={regenTone}
            onChange={(e) => setRegenTone(e.target.value as Tone)}
            disabled={!canMutate}
            aria-label="Tom para regeneração"
            style={{
              padding: '8px 10px',
              border: '2.5px solid var(--stroke)',
              borderRadius: 999,
              background: 'var(--surface)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              cursor: canMutate ? 'pointer' : 'not-allowed',
            }}
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-purple"
            onClick={handleRegenerate}
            disabled={!canMutate}
            aria-label="Regenerar resumo com novo tom"
            style={{ opacity: !canMutate ? 0.55 : 1 }}
          >
            {regenerating ? '⟳ regerando…' : '🎲 regenerar com novo tom'}
          </button>
        </div>

        <div style={{ flex: 1, minWidth: 10 }} />

        {!rejectingMode ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRejectingMode(true);
              setRejectReasonError(null);
            }}
            disabled={!canMutate}
            aria-label="Iniciar rejeição do resumo"
            style={{
              background: 'var(--color-red-500)',
              color: '#fff',
              opacity: !canMutate ? 0.55 : 1,
            }}
          >
            ✕ rejeitar
          </button>
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              width: '100%',
              paddingTop: 8,
              borderTop: '2px dashed var(--stroke)',
              marginTop: 4,
            }}
          >
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (rejectReasonError) setRejectReasonError(null);
              }}
              placeholder="motivo da rejeição (obrigatório)"
              aria-label="Motivo da rejeição"
              aria-invalid={rejectReasonError ? true : undefined}
              disabled={rejecting}
              style={{
                flex: 1,
                minWidth: 220,
                padding: '10px 14px',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                border: `2.5px solid ${rejectReasonError ? 'var(--color-red-500)' : 'var(--stroke)'}`,
                borderRadius: 999,
                background: 'var(--surface)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={handleRejectConfirm}
              disabled={rejectConfirmDisabled}
              aria-label="Confirmar rejeição"
              style={{
                background: 'var(--color-red-500)',
                color: '#fff',
                opacity: rejectConfirmDisabled ? 0.55 : 1,
              }}
            >
              {rejecting ? '⟳ rejeitando…' : 'confirmar rejeição'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRejectingMode(false);
                setRejectReason('');
                setRejectReasonError(null);
              }}
              disabled={rejecting}
              aria-label="Cancelar rejeição"
            >
              cancelar
            </button>
            {rejectReasonError && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-red-500)',
                  width: '100%',
                }}
              >
                {rejectReasonError}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            maxWidth: 380,
            padding: '14px 18px',
            borderRadius: 'var(--radius-md)',
            border: '2.5px solid var(--stroke)',
            background:
              toast.kind === 'success'
                ? 'var(--lime-500)'
                : 'rgba(255, 77, 60, 0.14)',
            color:
              toast.kind === 'success'
                ? 'var(--ink-900)'
                : 'var(--color-red-500)',
            boxShadow: 'var(--shadow-chunk-lg)',
            fontSize: 13,
            fontWeight: 700,
            zIndex: 50,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>
            {toast.kind === 'success' ? '✓' : '⚠'}
          </span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dispensar"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 800,
              color: 'inherit',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default SummaryEditor;
