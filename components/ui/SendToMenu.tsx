'use client';

/**
 * `SendToMenu` — dropdown de destinos pra enviar o podcast.
 *
 * Três ações reais + um "só escutar" (no-op):
 *   🔊 Só escutar                      → toca no player local
 *   👥 Grupo de origem                 → POST redeliver { target: 'group' }
 *   📱 Meu WhatsApp                    → POST redeliver { target: 'me' }
 *   👤 Outro contato                   → abre mini-form, POST { target: 'contact', jid }
 *
 * "Meu WhatsApp" precisa do phone cadastrado em tenant_members.phone_e164.
 * Se não tiver, exibe link "cadastrar meu WhatsApp" que abre um
 * segundo modal pra o user preencher.
 *
 * Component reusável entre HeroPlayer (/home) e DeliveryControls
 * (/podcasts) — ambos têm o mesmo quadro de decisão sobre destino.
 *
 * **Portal**: o menu, toast e modais renderizam via `createPortal` para
 * `document.body` — o HeroPlayer (e outros containers) usam
 * `overflow: hidden` pros blobs decorativos, que clippa elementos
 * absolutos internos. Portal escapa o clip e posiciona via
 * `getBoundingClientRect` do botão âncora.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type SendTarget = 'listen' | 'group' | 'me' | 'contact';

export interface SendResult {
  ok: boolean;
  target: SendTarget;
  message: string;
}

export interface SendToMenuProps {
  audioId: string;
  /** Reference para posicionamento do toast/confirmação. */
  label?: string;
  /** Primary cta (verde) ou secondary ghost. */
  variant?: 'primary' | 'secondary';
  /** Called after server responds (or after 'listen' no-op). */
  onResult?: (result: SendResult) => void;
  /** Called when user picks 'listen' — parent auto-plays. */
  onListen?: () => void;
}

type PhonePayload = { phone: string | null };

async function fetchMyPhone(): Promise<string | null> {
  try {
    const res = await fetch('/api/me/phone', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as PhonePayload;
    return body.phone;
  } catch {
    return null;
  }
}

async function saveMyPhone(phone: string): Promise<string | null> {
  const res = await fetch('/api/me/phone', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const body = (await res.json()) as
    | PhonePayload
    | { error?: { message?: string } };
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } }).error?.message ??
      'Falha ao salvar telefone.';
    throw new Error(msg);
  }
  return (body as PhonePayload).phone;
}

async function postSend(
  audioId: string,
  target: Exclude<SendTarget, 'listen'>,
  jid?: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `/api/audios/${encodeURIComponent(audioId)}/redeliver`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, jid }),
      cache: 'no-store',
    },
  );
  if (res.ok) {
    return { ok: true, message: labelForTargetSuccess(target) };
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return {
    ok: false,
    message: body?.error?.message ?? `Falha (${res.status}).`,
  };
}

function labelForTargetSuccess(target: Exclude<SendTarget, 'listen'>): string {
  switch (target) {
    case 'group':
      return 'Enviado ao grupo.';
    case 'me':
      return 'Enviado pra você no zap.';
    case 'contact':
      return 'Enviado ao contato.';
  }
}

export function SendToMenu({
  audioId,
  label = 'mandar no zap',
  variant = 'primary',
  onResult,
  onListen,
}: SendToMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastOk, setToastOk] = useState(false);
  const [phoneModal, setPhoneModal] = useState(false);
  const [contactModal, setContactModal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update anchor rect whenever the menu opens or the viewport changes
  // so the portal tracks the button even after scroll / resize.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (btnRef.current) {
        setAnchorRect(btnRef.current.getBoundingClientRect());
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on outside click. Since the menu is portaled, we have to check
  // both the button container AND the menu itself before dismissing.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleSend = useCallback(
    async (target: Exclude<SendTarget, 'listen'>, jid?: string) => {
      setBusy(true);
      setOpen(false);
      const result = await postSend(audioId, target, jid);
      setBusy(false);
      setToast(result.message);
      setToastOk(result.ok);
      onResult?.({ ok: result.ok, target, message: result.message });
      if (
        !result.ok &&
        target === 'me' &&
        /phone_not_set|cadastre seu whats/i.test(result.message)
      ) {
        setPhoneModal(true);
      }
    },
    [audioId, onResult],
  );

  const handlePick = useCallback(
    async (target: SendTarget) => {
      if (busy) return;
      setOpen(false);
      if (target === 'listen') {
        onListen?.();
        onResult?.({ ok: true, target: 'listen', message: 'Tocando preview.' });
        return;
      }
      if (target === 'contact') {
        setContactModal(true);
        return;
      }
      if (target === 'me') {
        const phone = await fetchMyPhone();
        if (!phone) {
          setPhoneModal(true);
          return;
        }
      }
      await handleSend(target);
    },
    [busy, handleSend, onListen, onResult],
  );

  const buttonClass = variant === 'primary' ? 'btn btn-zap' : 'btn btn-ghost';

  // Posição do menu portalado: 8px abaixo da borda inferior do botão,
  // alinhado à direita. Usa viewport coords (position: fixed) porque o
  // portal vive em document.body, não no container do botão.
  const menuStyle: React.CSSProperties | undefined = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 8,
        left: anchorRect.right - 280,
        minWidth: 260,
      }
    : undefined;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {busy ? '⟳ enviando…' : `📤 ${label}`}
        <span aria-hidden style={{ fontSize: 10, opacity: 0.8 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {mounted &&
        open &&
        !busy &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              ...menuStyle,
              background: 'var(--surface)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-chunk)',
              padding: 6,
              zIndex: 10000,
            }}
          >
            <MenuItem
              icon="🔊"
              title="Só escutar"
              desc="toca o preview aqui; nada é enviado"
              onClick={() => handlePick('listen')}
            />
            <MenuItem
              icon="👥"
              title="Enviar ao grupo"
              desc="manda no grupo de origem (whatsApp)"
              onClick={() => handlePick('group')}
              danger
            />
            <MenuItem
              icon="📱"
              title="Enviar pra mim"
              desc="pro meu WhatsApp cadastrado"
              onClick={() => handlePick('me')}
            />
            <MenuItem
              icon="👤"
              title="Outro contato…"
              desc="digita um número na hora"
              onClick={() => handlePick('contact')}
            />
          </div>,
          document.body,
        )}

      {mounted &&
        toast &&
        anchorRect &&
        createPortal(
          <div
            role="status"
            style={{
              position: 'fixed',
              top: anchorRect.bottom + 8,
              left: anchorRect.right - 200,
              padding: '6px 12px',
              background: toastOk ? 'var(--zap-500)' : 'var(--red-500)',
              color: '#fff',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 800,
              boxShadow: 'var(--shadow-chunk)',
              whiteSpace: 'nowrap',
              zIndex: 10000,
            }}
          >
            {toast}
          </div>,
          document.body,
        )}

      {mounted && phoneModal && (
        <PhonePromptModal
          onCancel={() => setPhoneModal(false)}
          onSaved={async () => {
            setPhoneModal(false);
            await handleSend('me');
          }}
        />
      )}

      {mounted && contactModal && (
        <ContactPromptModal
          onCancel={() => setContactModal(false)}
          onSubmit={async (jid) => {
            setContactModal(false);
            await handleSend('contact', jid);
          }}
        />
      )}
    </div>
  );
}

export default SendToMenu;

/* -------------------------------------------------------------------------- */
/* MenuItem                                                                   */
/* -------------------------------------------------------------------------- */

function MenuItem({
  icon,
  title,
  desc,
  onClick,
  danger,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 12px',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm, 8px)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-body)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span aria-hidden style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 800,
            color: danger ? 'var(--red-500)' : 'var(--text)',
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text-dim)',
            marginTop: 2,
          }}
        >
          {desc}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* PhonePromptModal                                                           */
/* -------------------------------------------------------------------------- */

function PhonePromptModal({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (phone: string) => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const saved = await saveMyPhone(value);
      if (!saved) throw new Error('O número ficou vazio após a normalização.');
      onSaved(saved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao salvar.');
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="cadastrar meu WhatsApp"
      subtitle="pra mandar podcasts pra você direto no zap"
      onClose={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
          }}
        >
          seu número (com DDD)
        </label>
        <input
          type="tel"
          placeholder="+55 11 99999-9999"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          autoFocus
          style={{
            padding: '10px 14px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 600,
            background: 'var(--surface)',
            color: 'var(--text)',
            boxShadow: '2px 2px 0 var(--stroke)',
            outline: 'none',
          }}
        />
        {err && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: 'var(--red-500)',
              fontWeight: 700,
            }}
          >
            ⚠ {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn btn-ghost"
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !value.trim()}
            className="btn btn-zap"
          >
            {saving ? '⟳ salvando…' : '💾 salvar e enviar'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* ContactPromptModal                                                         */
/* -------------------------------------------------------------------------- */

function ContactPromptModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (jid: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <ModalShell
      title="enviar pra um contato"
      subtitle="digita o número com DDD (ou +55 pra internacional)"
      onClose={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="tel"
          placeholder="+55 11 99999-9999"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          style={{
            padding: '10px 14px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 600,
            background: 'var(--surface)',
            color: 'var(--text)',
            boxShadow: '2px 2px 0 var(--stroke)',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost"
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            disabled={!value.trim()}
            className="btn btn-zap"
          >
            📤 enviar
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* ModalShell                                                                 */
/* -------------------------------------------------------------------------- */

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Portal → body pra escapar clip ancestral do HeroPlayer
  // (overflow: hidden no card roxo). z-index alto pra ficar acima do
  // dropdown (que já tá em 10000).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 10001,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'var(--text-dim)',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
