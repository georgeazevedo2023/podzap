'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';

/**
 * Slide-in drawer used as the mobile presentation of `Sidebar` /
 * `AdminSidebar`. Pure presentational shell: receives `open` + `onClose`
 * and renders children flush against the chosen side. The actual nav
 * markup lives in the existing `Sidebar` component, which is now placed
 * inside this drawer for `<md` viewports.
 *
 * Behaviour:
 *  - Backdrop fades in; click closes.
 *  - ESC closes.
 *  - Body scroll locks while open (prevents background scroll bleed on iOS).
 *  - Auto-focuses the first focusable element inside the panel for keyboard
 *    nav; restores focus to the trigger on close.
 *  - `aria-modal` + role=dialog so screen readers treat it as a modal.
 *
 * Animation: pure CSS transform on the panel + opacity on the backdrop.
 * 220ms is the sweet spot between "snappy" and "noticeable" for mobile UI.
 */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which side the drawer slides in from. Defaults to `left` (sidebar). */
  side?: 'left' | 'right';
  /** Drawer width. Defaults to a viewport-relative size that caps at 320px. */
  width?: string | number;
  /** ARIA label for the dialog. Falls back to "Menu". */
  label?: string;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  side = 'left',
  width = 'min(320px, 86vw)',
  label = 'Menu',
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // ESC closes. Bound only while open to avoid keydown churn.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Body scroll lock — the drawer covers a portion of the viewport and we
  // don't want the page underneath to scroll when the user pans within it.
  // We only lock while open and restore the previous overflow on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus management: stash whatever was focused (the hamburger trigger) and
  // move focus into the panel on open. Restore on close.
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      // Defer one tick so the panel is in the DOM and focusable.
      const id = window.setTimeout(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelector<HTMLElement>(
          'a, button, [tabindex]:not([tabindex="-1"]), input, select, textarea',
        );
        (focusable ?? panel).focus();
      }, 50);
      return () => window.clearTimeout(id);
    }
    previousFocus.current?.focus?.();
    return undefined;
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // We render the wrapper unconditionally and toggle visibility via CSS so
  // the slide-out animation plays on close. `pointer-events: none` while
  // closed makes sure the invisible backdrop doesn't intercept taps.
  const isLeft = side === 'left';
  const translateX = open ? '0' : isLeft ? '-100%' : '100%';

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(8, 3, 15, 0.55)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          transition: 'opacity 220ms ease',
        }}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [isLeft ? 'left' : 'right']: 0,
          width: typeof width === 'number' ? `${width}px` : width,
          maxWidth: '100vw',
          transform: `translateX(${translateX})`,
          transition: 'transform 220ms ease',
          background: 'var(--surface)',
          borderRight: isLeft ? '2.5px solid var(--stroke)' : 'none',
          borderLeft: !isLeft ? '2.5px solid var(--stroke)' : 'none',
          boxShadow: isLeft
            ? '6px 0 0 rgba(0,0,0,0.18)'
            : '-6px 0 0 rgba(0,0,0,0.18)',
          paddingTop: 'var(--safe-top)',
          paddingBottom: 'var(--safe-bottom)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          outline: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default Drawer;
