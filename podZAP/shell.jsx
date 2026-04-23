/* Sidebar + TopBar + AppShell for podZAP */

function Sidebar({ current, onNav }) {
  const items = [
    { id: 'home', label: 'Home', icon: <Ico.Home/> },
    { id: 'groups', label: 'Grupos', icon: <Ico.Group/> },
    { id: 'approval', label: 'Aprovação', icon: <Ico.Check/>, badge: 2 },
    { id: 'history', label: 'Histórico', icon: <Ico.History/> },
    { id: 'schedule', label: 'Agenda', icon: <Ico.Calendar/> },
  ];
  const devItems = [
    { id: 'onboarding', label: 'Conectar Zap', icon: <Ico.Zap/> },
    { id: 'settings', label: 'Ajustes', icon: <Ico.Settings/> },
  ];

  return (
    <aside style={{
      width: 248,
      background: 'var(--surface)',
      borderRight: '2.5px solid var(--stroke)',
      padding: '22px 16px',
      display: 'flex', flexDirection: 'column', gap: 6,
      flexShrink: 0,
      position: 'relative',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 20px' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'var(--purple-600)',
          border: '2.5px solid var(--stroke)',
          display: 'grid', placeItems: 'center',
          boxShadow: '3px 3px 0 var(--stroke)',
          transform: 'rotate(-4deg)',
        }}>
          <span style={{ color: '#fff', fontFamily: 'var(--font-brand)', fontSize: 20 }}>🎙</span>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-brand)', fontSize: 22, lineHeight: 1, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            pod<span style={{ color: 'var(--pink-500)' }}>ZAP</span>
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700, marginTop: 2 }}>
            zap → podcast
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '0 10px 6px' }}>
        Principal
      </div>
      {items.map(i => (
        <NavButton key={i.id} {...i} active={current === i.id} onClick={() => onNav(i.id)}/>
      ))}

      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '16px 10px 6px' }}>
        Setup
      </div>
      {devItems.map(i => (
        <NavButton key={i.id} {...i} active={current === i.id} onClick={() => onNav(i.id)}/>
      ))}

      <div style={{ flex: 1 }}/>

      {/* Plan card */}
      <div style={{
        background: 'var(--lime-500)',
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--r-md)',
        padding: 14,
        boxShadow: 'var(--shadow-chunk)',
        position: 'relative',
        color: 'var(--ink-900)',
      }}>
        <div style={{ position: 'absolute', top: -14, right: -10, transform: 'rotate(8deg)' }}>
          <span className="sticker pink">🔥 plano hype</span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, lineHeight: 1.1 }}>
          Você usou 7 de 15 resumos
        </div>
        <div style={{
          height: 10, background: '#fff', border: '2px solid var(--stroke)', borderRadius: 999, marginTop: 10, overflow: 'hidden',
        }}>
          <div style={{ width: '46%', height: '100%', background: 'var(--purple-600)' }}/>
        </div>
        <button className="btn purple" style={{ marginTop: 10, fontSize: 12, padding: '8px 14px', width: '100%', justifyContent: 'center' }}>
          upgradar o bagulho
        </button>
      </div>
    </aside>
  );
}

function NavButton({ id, label, icon, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px',
      border: 'none',
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
      border: active ? '2.5px solid var(--stroke)' : '2.5px solid transparent',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-2)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'grid', placeItems: 'center', opacity: active ? 1 : 0.7 }}>{icon}</span>
      <span>{label}</span>
      {badge && (
        <span style={{
          marginLeft: 'auto',
          background: 'var(--pink-500)',
          color: '#fff',
          border: '2px solid var(--stroke)',
          borderRadius: 999,
          minWidth: 22, height: 22,
          padding: '0 6px',
          fontSize: 11, fontWeight: 800,
          display: 'grid', placeItems: 'center',
        }}>{badge}</span>
      )}
    </button>
  );
}

function TopBar({ title, subtitle, accent = 'purple', actions, breadcrumb }) {
  const bgMap = {
    purple: 'var(--purple-600)', pink: 'var(--pink-500)', lime: 'var(--lime-500)', yellow: 'var(--yellow-500)', zap: 'var(--zap-500)',
  };
  const fgMap = {
    purple: '#fff', pink: '#fff', lime: 'var(--ink-900)', yellow: 'var(--ink-900)', zap: '#fff',
  };
  return (
    <div style={{
      padding: '26px 36px 22px',
      borderBottom: '2.5px solid var(--stroke)',
      background: 'var(--surface)',
      display: 'flex', alignItems: 'center', gap: 20,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* accent blob */}
      <div style={{
        position: 'absolute', right: -40, top: -40, width: 200, height: 200,
        background: bgMap[accent], borderRadius: '50%',
        opacity: 0.12,
      }}/>

      <div style={{ flex: 1, zIndex: 2 }}>
        {breadcrumb && (
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>
            {breadcrumb}
          </div>
        )}
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 38,
          lineHeight: 1,
          letterSpacing: '-0.025em',
          color: 'var(--text)',
        }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 8, fontWeight: 500 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', zIndex: 2 }}>
        {actions}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar, NavButton });
