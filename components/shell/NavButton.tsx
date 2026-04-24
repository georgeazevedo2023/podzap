'use client';

import type { MouseEvent, ReactNode } from 'react';

/**
 * Sidebar nav row — icon + label with an optional numeric badge (e.g. pending
 * approvals). Active state flips to `--purple-600` background with a chunky
 * shadow + stroke; inactive rows get a subtle hover fill of `--bg-2`.
 *
 * Used by `Sidebar` (app shell) and adapted inline by `AdminSidebar` for the
 * superadmin shell. The badge is only rendered when `badge > 0` — zero is
 * hidden deliberately to avoid pill noise.
 */
export interface NavButtonProps {
  /** Stable id used by the parent to decide `active`. */
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function NavButton({
  label,
  icon,
  active = false,
  badge,
  onClick,
}: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: active ? 'var(--purple-600)' : 'transparent',
        color: active ? '#fff' : 'var(--text)',
        borderRadius: 'var(--r-md)',
        fontFamily: 'var(--font-body)',
        fontWeight: 700,
        fontSize: 14,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.12s ease',
        position: 'relative',
        boxShadow: active ? '3px 3px 0 var(--stroke)' : 'none',
        border: active
          ? '2.5px solid var(--stroke)'
          : '2.5px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-2)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          opacity: active ? 1 : 0.7,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            marginLeft: 'auto',
            background: 'var(--pink-500)',
            color: '#fff',
            border: '2px solid var(--stroke)',
            borderRadius: 999,
            minWidth: 22,
            height: 22,
            padding: '0 6px',
            fontSize: 11,
            fontWeight: 800,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export default NavButton;
