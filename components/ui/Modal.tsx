'use client';

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icons } from '@/components/icons/Icons';

/**
 * Reusable dark/chunky modal primitive.
 *
 * Rendered via `createPortal` into `document.body` so it sits above any
 * z-index context inside the app layout. Honors the podZAP design tokens
 * (`--color-surface`, `--color-stroke`, `--radius-lg`, `--shadow-chunk-lg`,
 * `--font-display`) defined in `app/globals.css`.
 *
 * Usage:
 *   <Modal open={open} onClose={close} title="Gerar resumo agora"
 *     footer={<><Button variant="ghost" onClick={close}>Cancelar</Button>
 *              <Button variant="purple" onClick={submit}>Gerar</Button></>}>
 *     <p>Confirma gerar um resumo do grupo agora?</p>
 *   </Modal>
 */
export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Typically cancel + confirm buttons. Right-aligned under a border-top. */
  footer?: ReactNode;
  /** Max width: sm=360, md=480 (default), lg=640. */
  size?: ModalSize;
}

const MAX_WIDTH: Record<ModalSize, number> = {
  sm: 360,
  md: 480,
  lg: 640,
};

// Stacks above any app chrome. `.login-card` uses z-index 10, animated
// backdrops ~1-2. Nothing in globals.css approaches 9999, so this is the
// canonical top layer for overlays.
const Z_INDEX = 9999;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: ModalProps): React.ReactElement | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ESC-to-close + body scroll lock. Both are gated on `open` so the effect
  // is cheap when the modal is mounted but hidden.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Focus the dialog container when it opens. No focus trap — deliberately
  // lightweight; callers that need one should swap in a headless lib.
  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  // SSR + closed: render nothing. `document` is only touched on the client.
  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const backdropStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: Z_INDEX,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  };

  const dialogStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    maxWidth: MAX_WIDTH[size],
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '2.5px solid var(--color-stroke)',
    borderRadius: 'var(--radius-lg, 20px)',
    boxShadow: 'var(--shadow-chunk-lg, 8px 8px 0 var(--color-stroke))',
    outline: 'none',
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle: CSSProperties = {
    padding: '20px 56px 16px 24px',
    display: 'flex',
    alignItems: 'center',
  };

  const titleStyle: CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: 22,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    margin: 0,
    color: 'var(--color-text)',
  };

  const bodyStyle: CSSProperties = {
    padding: '0 24px 24px',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--color-text)',
  };

  const footerStyle: CSSProperties = {
    padding: '16px 24px',
    borderTop: '1.5px solid var(--color-stroke)',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  };

  const closeBtnStyle: CSSProperties = {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.12s ease',
  };

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if the mousedown started on the backdrop itself — prevents
    // "drag selection started inside, released outside" from closing.
    if (e.target === e.currentTarget) onClose();
  };

  const CloseIcon = Icons.X;

  const modal = (
    <div
      style={backdropStyle}
      onMouseDown={handleBackdropMouseDown}
      aria-hidden={false}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dialogStyle}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          style={closeBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {CloseIcon ? <CloseIcon width={18} height={18} /> : <span aria-hidden>×</span>}
        </button>

        <div style={headerStyle}>
          <h2 id={titleId} style={titleStyle}>
            {title}
          </h2>
        </div>

        <div style={bodyStyle}>{children}</div>

        {footer !== undefined && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default Modal;
