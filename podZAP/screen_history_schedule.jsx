/* History + Schedule combined file to keep count down */

function HistoryScreen({ onNav }) {
  const [view, setView] = React.useState('grid');
  const eps = [
    { t: 'família do caos', s: 'ep. 42', v: 0, d: 'hoje', m: '18:42', status: 'published', plays: 23 },
    { t: 'vendas sp', s: 'ep. 128', v: 1, d: 'ontem', m: '5:32', status: 'published', plays: 47 },
    { t: 'dev brasil', s: 'ep. 67', v: 3, d: '2d', m: '12:04', status: 'pending', plays: 0 },
    { t: 'mães linha', s: 'ep. 201', v: 2, d: '3d', m: '8:15', status: 'published', plays: 89 },
    { t: 'churras do zé', s: 'ep. 14', v: 4, d: '4d', m: '4:50', status: 'published', plays: 12 },
    { t: 'marketing', s: 'ep. 33', v: 5, d: '5d', m: '6:22', status: 'draft', plays: 0 },
    { t: 'família do caos', s: 'ep. 41', v: 0, d: '1sem', m: '14:20', status: 'published', plays: 156 },
    { t: 'vendas sp', s: 'ep. 127', v: 1, d: '1sem', m: '7:08', status: 'published', plays: 38 },
    { t: 'dev brasil', s: 'ep. 66', v: 3, d: '1sem', m: '11:45', status: 'rejected', plays: 0 },
    { t: 'mães linha', s: 'ep. 200', v: 2, d: '2sem', m: '9:30', status: 'published', plays: 201 },
  ];

  const statusMap = {
    published: { label: '🎧 no ar', color: 'var(--zap-500)', fg: '#fff' },
    pending: { label: '⏳ revisão', color: 'var(--yellow-500)', fg: 'var(--ink-900)' },
    draft: { label: '📝 rascunho', color: 'var(--bg-2)', fg: 'var(--text)' },
    rejected: { label: '❌ rejeitado', color: 'var(--red-500)', fg: '#fff' },
  };

  return (
    <div style={{ padding: '24px 36px 40px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 22, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface)', padding: 4, borderRadius: 999, border: '2.5px solid var(--stroke)', boxShadow: '3px 3px 0 var(--stroke)' }}>
          {['tudo', 'no ar', 'revisão', 'rascunhos'].map((k, i) => (
            <button key={k} style={{
              padding: '8px 16px', border: 'none',
              background: i === 0 ? 'var(--purple-600)' : 'transparent',
              color: i === 0 ? '#fff' : 'var(--text)',
              borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}>{k}</button>
          ))}
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
          {view === 'grid' ? '☰ lista' : '▦ grade'}
        </button>
      </div>

      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
          {eps.map((ep, i) => {
            const s = statusMap[ep.status];
            return (
              <div key={i} style={{ position: 'relative' }}>
                <PodCover title={ep.t} subtitle={ep.s} variant={ep.v} size={220} date={ep.d}/>
                <div style={{ position: 'absolute', top: 10, right: 10 }}>
                  <span style={{
                    background: s.color, color: s.fg,
                    padding: '3px 8px', borderRadius: 999,
                    fontSize: 10, fontWeight: 800, border: '2px solid var(--stroke)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    boxShadow: '2px 2px 0 var(--stroke)',
                  }}>{s.label}</span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button className="btn" style={{ padding: '6px 10px', fontSize: 11 }}><Ico.Play/></button>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{ep.m}</div>
                  <div style={{ flex: 1 }}/>
                  {ep.plays > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
                      👂 {ep.plays}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {eps.map((ep, i) => {
            const s = statusMap[ep.status];
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: 14,
                borderBottom: i < eps.length - 1 ? '2px solid var(--stroke)' : 'none',
                background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg-2)',
              }}>
                <PodCover title={ep.t} subtitle={ep.s} variant={ep.v} size={56}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>{ep.t} — {ep.s}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{ep.d} · {ep.m} · {ep.plays} plays</div>
                </div>
                <span style={{
                  background: s.color, color: s.fg,
                  padding: '4px 10px', borderRadius: 999,
                  fontSize: 10, fontWeight: 800, border: '2px solid var(--stroke)',
                }}>{s.label}</span>
                <button className="btn" style={{ padding: '6px 10px', fontSize: 11 }}><Ico.Play/></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────── SCHEDULE ───────────────
function ScheduleScreen() {
  const [mode, setMode] = React.useState('fixed');
  const [autoMode, setAutoMode] = React.useState('review');

  return (
    <div style={{ padding: '24px 36px 40px', overflowY: 'auto', height: '100%', maxWidth: 980 }}>
      {/* Schedule type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { id: 'fixed', t: 'horário fixo', d: 'todo dia na mesma hora', i: '⏰', c: 'var(--lime-500)' },
          { id: 'idle', t: 'após inatividade', d: 'quando o grupo der uma calmada', i: '😴', c: 'var(--pink-500)', fg: '#fff' },
          { id: 'smart', t: 'janela esperta', d: 'quando rolar assunto bom', i: '🧠', c: 'var(--purple-600)', fg: '#fff' },
        ].map(o => {
          const on = mode === o.id;
          return (
            <button key={o.id} onClick={() => setMode(o.id)} style={{
              padding: 18, textAlign: 'left',
              background: on ? o.c : 'var(--surface)',
              color: on ? (o.fg || 'var(--ink-900)') : 'var(--text)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--r-lg)',
              cursor: 'pointer', fontFamily: 'var(--font-body)',
              boxShadow: on ? '5px 5px 0 var(--stroke)' : '2px 2px 0 var(--stroke)',
              transition: 'all 0.12s',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{o.i}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>{o.t}</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{o.d}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Time config */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, marginBottom: 14, letterSpacing: '-0.01em' }}>
            🕐 quando gerar
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <TimeRow label="gerar resumo" value="19:00" note="todo dia"/>
            <TimeRow label="enviar podcast" value="21:30" note="após aprovação"/>
          </div>
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: '2px dashed var(--stroke)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
              dias da semana
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['seg','ter','qua','qui','sex','sáb','dom'].map((d, i) => {
                const on = i < 5;
                return (
                  <button key={d} style={{
                    width: 42, height: 42, borderRadius: '50%',
                    background: on ? 'var(--purple-600)' : 'var(--bg-2)',
                    color: on ? '#fff' : 'var(--text)',
                    border: '2.5px solid var(--stroke)',
                    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 800,
                    cursor: 'pointer', textTransform: 'uppercase',
                    boxShadow: on ? '2px 2px 0 var(--stroke)' : 'none',
                  }}>{d}</button>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>frequência</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>quantas vezes por semana</div>
            </div>
            <select style={{
              padding: '8px 14px', border: '2.5px solid var(--stroke)',
              borderRadius: 999, fontFamily: 'var(--font-body)', fontWeight: 700,
              background: 'var(--lime-500)', color: 'var(--ink-900)', fontSize: 13,
              boxShadow: '2px 2px 0 var(--stroke)', cursor: 'pointer',
            }}>
              <option>diário</option>
              <option>semanal</option>
              <option>a cada 3 dias</option>
            </select>
          </div>
        </div>

        {/* Approval mode */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, marginBottom: 14, letterSpacing: '-0.01em' }}>
            ✏️ modo de aprovação
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { id: 'auto', t: 'automático', d: 'gera e manda sem revisar', i: '🚀' },
              { id: 'review', t: 'aprovação opcional', d: 'alerta você, manda em 30min se ignorar', i: '👀' },
              { id: 'required', t: 'aprovação obrigatória', d: 'nada sai sem seu ok', i: '🔒' },
            ].map(o => {
              const on = autoMode === o.id;
              return (
                <button key={o.id} onClick={() => setAutoMode(o.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 12, textAlign: 'left',
                  background: on ? 'var(--yellow-500)' : 'var(--bg-2)',
                  color: on ? 'var(--ink-900)' : 'var(--text)',
                  border: '2.5px solid var(--stroke)',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                  boxShadow: on ? '3px 3px 0 var(--stroke)' : 'none',
                }}>
                  <div style={{ fontSize: 22 }}>{o.i}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{o.t}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>{o.d}</div>
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: on ? 'var(--ink-900)' : '#fff',
                    border: '2.5px solid var(--stroke)',
                    display: 'grid', placeItems: 'center',
                  }}>
                    {on && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lime-500)' }}/>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost">cancelar</button>
        <button className="btn pink"><Ico.Check/> salvar agenda</button>
      </div>
    </div>
  );
}

function TimeRow({ label, value, note }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 12,
      background: 'var(--bg-2)',
      border: '2px solid var(--stroke)',
      borderRadius: 'var(--r-md)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{note}</div>
      </div>
      <div style={{
        fontFamily: 'var(--font-brand)', fontSize: 22,
        padding: '6px 14px',
        background: '#fff',
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--r-md)',
        boxShadow: '2px 2px 0 var(--stroke)',
        color: 'var(--ink-900)',
        letterSpacing: '-0.02em',
      }}>{value}</div>
    </div>
  );
}

Object.assign(window, { HistoryScreen, ScheduleScreen });
