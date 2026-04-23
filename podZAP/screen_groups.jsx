/* Groups screen: list + select groups to monitor */

function GroupsScreen({ onNav }) {
  const [filter, setFilter] = React.useState('all');
  const [selected, setSelected] = React.useState(new Set(['g1', 'g2', 'g4']));
  const [search, setSearch] = React.useState('');

  const groups = [
    { id: 'g1', name: 'Família do Caos', members: 14, msgs: 247, audios: 12, active: true, emoji: '🔥', cover: 0, last: '2min' },
    { id: 'g2', name: 'Vendas SP - Time B', members: 28, msgs: 1203, audios: 34, active: true, emoji: '💼', cover: 1, last: '5min' },
    { id: 'g3', name: 'Futebol de Quarta', members: 22, msgs: 89, audios: 4, active: false, emoji: '⚽', cover: 5, last: '3h' },
    { id: 'g4', name: 'Dev Brasil', members: 187, msgs: 2104, audios: 8, active: true, emoji: '💻', cover: 3, last: '1min' },
    { id: 'g5', name: 'Mães Linha de Frente', members: 45, msgs: 567, audios: 22, active: true, emoji: '👶', cover: 2, last: '12min' },
    { id: 'g6', name: 'Churrasco do Zé', members: 12, msgs: 45, audios: 2, active: false, emoji: '🥩', cover: 4, last: '2d' },
    { id: 'g7', name: 'Marketing Squad', members: 9, msgs: 178, audios: 5, active: true, emoji: '📣', cover: 1, last: '22min' },
    { id: 'g8', name: 'Vizinhança do Prédio', members: 64, msgs: 332, audios: 15, active: false, emoji: '🏢', cover: 0, last: '1d' },
  ];

  const filtered = groups.filter(g => {
    if (filter === 'active' && !g.active) return false;
    if (filter === 'monitored' && !selected.has(g.id)) return false;
    if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggle = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  return (
    <div style={{ padding: '24px 36px 40px', overflowY: 'auto', height: '100%' }}>
      {/* Top controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{
          flex: 1, minWidth: 240,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--r-pill)',
          boxShadow: '3px 3px 0 var(--stroke)',
        }}>
          <span style={{ fontSize: 18 }}>🔎</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="busca um grupo aí..."
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500, color: 'var(--text)',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface)', padding: 4, borderRadius: 999, border: '2.5px solid var(--stroke)', boxShadow: '3px 3px 0 var(--stroke)' }}>
          {[['all', 'todos'], ['active', 'ativos'], ['monitored', `monitorados (${selected.size})`]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: '8px 14px', border: 'none',
              background: filter === k ? 'var(--purple-600)' : 'transparent',
              color: filter === k ? '#fff' : 'var(--text)',
              borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Quick info strip */}
      <div style={{
        background: 'var(--lime-500)',
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--r-lg)',
        padding: '14px 20px',
        boxShadow: '4px 4px 0 var(--stroke)',
        marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 14,
        color: 'var(--ink-900)',
      }}>
        <div style={{ fontSize: 28 }}>🎯</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>
            {selected.size} grupos no radar
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>
            só esses viram podcast. clica no card pra ativar/desativar.
          </div>
        </div>
        <button className="btn purple" onClick={() => onNav('schedule')}>
          configurar agenda →
        </button>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.map(g => {
          const on = selected.has(g.id);
          return (
            <div key={g.id} onClick={() => toggle(g.id)} style={{
              background: on ? 'var(--surface)' : 'var(--bg-2)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--r-lg)',
              padding: 16,
              boxShadow: on ? '5px 5px 0 var(--stroke)' : '2px 2px 0 var(--stroke)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              position: 'relative',
              opacity: on ? 1 : 0.75,
            }}>
              {/* Toggle */}
              <div style={{
                position: 'absolute', top: 12, right: 12,
                width: 42, height: 24, borderRadius: 999,
                background: on ? 'var(--zap-500)' : 'var(--ink-500)',
                border: '2px solid var(--stroke)',
                padding: 2, transition: 'background 0.15s',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: '#fff',
                  transform: on ? 'translateX(18px)' : 'translateX(0)',
                  transition: 'transform 0.15s',
                  border: '1.5px solid var(--stroke)',
                }}/>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <PodCover title={g.name.split(' ')[0].toLowerCase()} variant={g.cover} size={64}/>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 48 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: 2 }}>
                    {g.emoji} {g.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {g.members} pessoas · últ: {g.last}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                <span className="sticker" style={{ background: 'var(--bg-2)', borderColor: 'var(--stroke)', color: 'var(--text)' }}>
                  💬 {g.msgs} msgs
                </span>
                <span className="sticker pink">
                  🎤 {g.audios} áudios
                </span>
                {g.active && <span className="sticker zap"><span className="live-dot"/> ativo</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { GroupsScreen });
