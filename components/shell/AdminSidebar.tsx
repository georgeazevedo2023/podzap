'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icons } from '../icons/Icons';
import { Sticker } from '../ui/Sticker';

/**
 * Canonical nav ids for the superadmin shell. Mirrors the URL layout under
 * `/admin/*`. Kept separate from the tenant-app `NavId` union so the two
 * sidebars can evolve independently.
 */
export type AdminNavId = 'dashboard' | 'tenants' | 'users' | 'uazapi';

interface AdminNavItem {
  id: AdminNavId;
  label: string;
  icon: ReactNode;
}

const ROUTES: Record<AdminNavId, string> = {
  dashboard: '/admin',
  tenants: '/admin/tenants',
  users: '/admin/users',
  uazapi: '/admin/uazapi',
};

/**
 * Derives the active admin nav id from the current pathname. Defaults to
 * `dashboard` for bare `/admin` and falls back to it for unknown sub-paths.
 */
function pathToAdminNavId(pathname: string): AdminNavId {
  // Longest-prefix match — `/admin/tenants/:id` still activates `tenants`.
  let best: AdminNavId = 'dashboard';
  let bestLen = -1;
  (Object.keys(ROUTES) as AdminNavId[]).forEach((id) => {
    const base = ROUTES[id];
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      if (base.length > bestLen) {
        best = id;
        bestLen = base.length;
      }
    }
  });
  return best;
}

export interface AdminSidebarProps {
  /** Logged-in superadmin's email (rendered truncated in the account chip). */
  userEmail: string;
}

/**
 * Superadmin navigation shell — parallel to `AppSidebar` but scoped to the
 * `/admin/*` route group. Intentionally visually distinct:
 *   - Purple brand block is flipped to pink to signal "you are in the admin
 *     cockpit, not the tenant app".
 *   - No "plan usage" card — superadmins aren't billed.
 *   - Footer offers a "voltar pro app" link so a superadmin with a tenant
 *     membership can jump back to `/home`.
 */
export function AdminSidebar({ userEmail }: AdminSidebarProps) {
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();
  const current = pathToAdminNavId(pathname);

  const items: AdminNavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <Icons.Home /> },
    { id: 'tenants', label: 'Tenants', icon: <Icons.Group /> },
    { id: 'users', label: 'Usuários', icon: <Icons.Check /> },
    { id: 'uazapi', label: 'Instâncias', icon: <Icons.Zap /> },
  ];

  const truncatedEmail =
    userEmail.length > 26 ? `${userEmail.slice(0, 23)}…` : userEmail;

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
      {/* Brand block — pink accent marks this as the admin shell */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 8px 16px',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'var(--pink-500)',
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
            ⚡
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
            super
            <span
              style={{
                color: 'var(--pink-500)',
                textShadow: '2px 2px 0 var(--stroke)',
              }}
            >
              admin
            </span>
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
            podZAP · painel
          </div>
        </div>
      </div>

      {/* Distinctive admin sticker — makes the mode shift obvious at a glance */}
      <div style={{ padding: '0 8px 10px' }}>
        <Sticker variant="pink">🔒 modo admin</Sticker>
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
        Gestão
      </div>
      {items.map((i) => (
        <AdminNavButton
          key={i.id}
          label={i.label}
          icon={i.icon}
          active={current === i.id}
          onClick={() => router.push(ROUTES[i.id])}
        />
      ))}

      <div style={{ flex: 1 }} />

      {/* Back-to-app link — superadmins that also belong to a tenant can jump
          back to the regular app shell without logging out. */}
      <a
        href="/home"
        className="btn btn-ghost"
        style={{
          fontSize: 12,
          padding: '10px 12px',
          justifyContent: 'flex-start',
          fontWeight: 700,
        }}
      >
        ← voltar pro app
      </a>

      {/* Account chip — email + logout */}
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-2)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--pink-500)',
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
    </aside>
  );
}

export default AdminSidebar;

/* ------------------------------------------------------------------ */
/* Inline nav button — trimmed variant of the app-shell NavButton.     */
/* Kept local so the admin sidebar has zero dependencies on the tenant */
/* sidebar's prop surface.                                             */
/* ------------------------------------------------------------------ */

interface AdminNavButtonProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

function AdminNavButton({
  label,
  icon,
  active,
  onClick,
}: AdminNavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: active ? 'var(--pink-500)' : 'transparent',
        color: active ? '#fff' : 'var(--text)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-body)',
        fontWeight: 700,
        fontSize: 14,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.12s ease',
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
    </button>
  );
}
