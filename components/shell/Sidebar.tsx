'use client';

import type { ReactNode } from 'react';
import { Icons } from '../icons/Icons';
import { Button } from '../ui/Button';
import { Sticker } from '../ui/Sticker';
import { NavButton } from './NavButton';

/**
 * Canonical nav ids. Screens and the router can import this union to stay in
 * sync with the sidebar without stringly-typing the current route.
 */
export type NavId =
  | 'home'
  | 'groups'
  | 'approval'
  | 'podcasts'
  | 'history'
  | 'schedule'
  | 'onboarding'
  | 'settings';

interface NavItem {
  id: NavId;
  label: string;
  icon: ReactNode;
  badge?: number;
}

/**
 * Aggregated state of the tenant's WhatsApp connection, as surfaced in the
 * sidebar. Mirrors the enum in `whatsapp_instances.status` plus a synthetic
 * `none` case for tenants that have never provisioned an instance.
 */
export type WhatsappStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'none';

export interface SidebarProps {
  current: NavId;
  onNav: (id: NavId) => void;
  /** Optional: override the "7 de 15" progress widget. */
  usage?: {
    used: number;
    total: number;
    label?: string;
  };
  /** Logged-in user's email (rendered truncated in the account chip). */
  userEmail?: string;
  /** Current tenant display name (used in the plan card header). */
  tenantName?: string;
  /** Current tenant plan identifier (e.g. "free", "pro") — surfaced in the plan card. */
  tenantPlan?: string;
  /**
   * Current connection state of the tenant's WhatsApp instance (if any). Drives
   * the colored status dot rendered next to the "Conectar Zap" nav item.
   * Defaults to `'none'` — treated visually the same as `'disconnected'`.
   */
  whatsappStatus?: WhatsappStatus;
  /**
   * Optional phone number attached to the connected instance. Rendered as a
   * small secondary line under "WhatsApp" when `whatsappStatus === 'connected'`.
   */
  whatsappPhone?: string | null;
  /**
   * Count of summaries awaiting human review (status `pending_review`) for
   * the current tenant. Drives the numeric badge on "Aprovação". When `0`
   * or undefined, no badge is rendered (vs. a visible "0" pill).
   */
  pendingApprovals?: number;
}

export function Sidebar({
  current,
  onNav,
  usage,
  userEmail,
  tenantName,
  tenantPlan,
  whatsappStatus = 'none',
  whatsappPhone,
  pendingApprovals,
}: SidebarProps) {
  // Only surface the badge when there's actual work pending — rendering a "0"
  // is noisy and trains users to ignore the pill.
  const approvalBadge =
    pendingApprovals && pendingApprovals > 0 ? pendingApprovals : undefined;
  const items: NavItem[] = [
    { id: 'home', label: 'Home', icon: <Icons.Home /> },
    { id: 'groups', label: 'Grupos', icon: <Icons.Group /> },
    {
      id: 'approval',
      label: 'Aprovação',
      icon: <Icons.Check />,
      badge: approvalBadge,
    },
    { id: 'podcasts', label: 'Podcasts', icon: <Icons.Play /> },
    { id: 'history', label: 'Histórico', icon: <Icons.History /> },
    { id: 'schedule', label: 'Agenda', icon: <Icons.Calendar /> },
  ];

  // "Conectar Zap" morphs into "WhatsApp + status dot" once we know there's
  // (or was) an instance. The click target remains `/onboarding` in all
  // states — it doubles as the detail/manage screen.
  const zapLabel = whatsappStatus === 'none' ? 'Conectar Zap' : 'WhatsApp';
  const devItems: NavItem[] = [
    { id: 'onboarding', label: zapLabel, icon: <Icons.Zap /> },
    { id: 'settings', label: 'Ajustes', icon: <Icons.Settings /> },
  ];

  const used = usage?.used ?? 0;
  const total = usage?.total ?? 15;
  // If a tenant is present, show its plan + usage instead of the mock "7 de 15".
  const usageLabel =
    usage?.label ??
    (tenantPlan
      ? `plano ${tenantPlan} · ${used}/${total} resumos`
      : `Você usou ${used} de ${total} resumos`);
  const pct = Math.max(0, Math.min(100, (used / total) * 100));

  const truncatedEmail =
    userEmail && userEmail.length > 26
      ? `${userEmail.slice(0, 23)}…`
      : userEmail;

  return (
    <aside
      style={{
        width: 248,
        background: 'var(--surface)',
        borderRight: '2.5px solid var(--stroke)',
        padding: '22px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 8px 20px',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'var(--purple-600)',
            border: '2.5px solid var(--stroke)',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '3px 3px 0 var(--stroke)',
            transform: 'rotate(-4deg)',
          }}
        >
          <span
            style={{
              color: '#fff',
              fontFamily: 'var(--font-brand)',
              fontSize: 20,
            }}
          >
            🎙
          </span>
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-brand)',
              fontSize: 22,
              lineHeight: 1,
              color: 'var(--text)',
              letterSpacing: '-0.02em',
            }}
          >
            pod<span style={{ color: 'var(--pink-500)' }}>ZAP</span>
          </div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--text-dim)',
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {tenantName ? tenantName : 'zap → podcast'}
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          padding: '0 10px 6px',
        }}
      >
        Principal
      </div>
      {items.map((i) => (
        <NavButton
          key={i.id}
          id={i.id}
          label={i.label}
          icon={i.icon}
          badge={i.badge}
          active={current === i.id}
          onClick={() => onNav(i.id)}
        />
      ))}

      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          padding: '16px 10px 6px',
        }}
      >
        Setup
      </div>
      {devItems.map((i) =>
        i.id === 'onboarding' ? (
          <WhatsappNavRow
            key={i.id}
            active={current === i.id}
            label={i.label}
            icon={i.icon}
            status={whatsappStatus}
            phone={whatsappPhone}
            onClick={() => onNav(i.id)}
          />
        ) : (
          <NavButton
            key={i.id}
            id={i.id}
            label={i.label}
            icon={i.icon}
            badge={i.badge}
            active={current === i.id}
            onClick={() => onNav(i.id)}
          />
        ),
      )}

      <div style={{ flex: 1 }} />

      {/* Plan card */}
      <div
        style={{
          background: 'var(--lime-500)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--r-md)',
          padding: 14,
          boxShadow: 'var(--shadow-chunk)',
          position: 'relative',
          color: 'var(--ink-900)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -14,
            right: -10,
            transform: 'rotate(8deg)',
          }}
        >
          <Sticker variant="pink">🔥 plano hype</Sticker>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 15,
            lineHeight: 1.1,
          }}
        >
          {usageLabel}
        </div>
        <div
          style={{
            height: 10,
            background: '#fff',
            border: '2px solid var(--stroke)',
            borderRadius: 999,
            marginTop: 10,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'var(--purple-600)',
            }}
          />
        </div>
        <Button
          variant="purple"
          style={{
            marginTop: 10,
            fontSize: 12,
            padding: '8px 14px',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          upgradar o bagulho
        </Button>
      </div>

      {/* Account chip — email + logout */}
      {userEmail && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--purple-600)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-brand)',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={userEmail}
          >
            {truncatedEmail}
          </div>
          <a
            href="/logout"
            className="btn btn-ghost"
            style={{
              fontSize: 11,
              padding: '4px 8px',
              fontWeight: 700,
            }}
          >
            sair
          </a>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;

/* ------------------------------------------------------------------ */
/* Inline nav row: "Conectar Zap" with a live-status dot + phone.      */
/* ------------------------------------------------------------------ */

interface WhatsappNavRowProps {
  active: boolean;
  label: string;
  icon: ReactNode;
  status: WhatsappStatus;
  phone?: string | null;
  onClick: () => void;
}

/**
 * Variant of `NavButton` that adds a small colored status dot + optional phone
 * subtitle. Kept in-file to avoid a second button component while the whole
 * sidebar still uses inline `style` blocks (see `NavButton`).
 */
function WhatsappNavRow({
  active,
  label,
  icon,
  status,
  phone,
  onClick,
}: WhatsappNavRowProps) {
  const dotColor =
    status === 'connected'
      ? '#22C55E' // green
      : status === 'connecting'
        ? '#F59E0B' // amber
        : '#9CA3AF'; // gray (disconnected / none)

  // `connecting` reuses the `.live-dot` CSS (pulse animation). Other states
  // render a static dot.
  const dotClassName = status === 'connecting' ? 'live-dot' : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        status === 'connected'
          ? `WhatsApp conectado${phone ? ` · ${phone}` : ''}`
          : status === 'connecting'
            ? 'WhatsApp conectando…'
            : status === 'disconnected'
              ? 'WhatsApp desconectado — clique para reconectar'
              : 'WhatsApp não conectado — clique para conectar'
      }
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
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          lineHeight: 1.15,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span>{label}</span>
        {status === 'connected' && phone && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.75,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {phone}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={dotClassName}
        style={{
          marginLeft: 'auto',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: dotColor,
          border: '2px solid var(--stroke)',
          flexShrink: 0,
        }}
      />
    </button>
  );
}
