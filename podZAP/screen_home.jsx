/* Home screen — dashboard with player + recent + stats */

function HomeScreen({ onNav, onGenerate }) {
  const [playing, setPlaying] = React.useState(true);
  const [progress, setProgress] = React.useState(0.32);

  React.useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setProgress(p => p >= 1 ? 0 : p + 0.003), 200);
    return () => clearInterval(t);
  }, [playing]);

  const fmtTime = (p) => {
    const total = 18 * 60 + 42; // 18:42
    const cur = Math.floor(total * p);
    return `${Math.floor(cur / 60)}:${String(cur % 60).padStart(2,'0')}`;
  };

  return (
    <div style={{ padding: '24px 36px 40px', display: 'grid', gap: 20, gridTemplateColumns: '1fr 320px', overflowY: 'auto', height: '100%' }}>
      {/* LEFT COLUMN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Hero player */}
        <div style={{
          background: 'var(--purple-600)',
          color: '#fff',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--r-xl)',
          padding: 24,
          boxShadow: 'var(--shadow-chunk-lg)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* decorative */}
          <div style={{ position: 'absolute', right: -50, top: -50, width: 220, height: 220, background: 'var(--pink-500)', borderRadius: '50%', opacity: 0.35 }}/>
          <div style={{ position: 'absolute', right: 80, bottom: -40, width: 140, height: 140, background: 'var(--lime-500)', borderRadius: '50%', opacity: 0.25 }}/>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, position: 'relative', zIndex: 2 }}>
            <PodCover title="família do caos" subtitle="ep. 42 · hoje" variant={0} size={140} date="22 abr"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <span className="sticker yellow">🎧 tá no ar</span>
                <span className="sticker" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '2px solid #fff' }}>
                  <span className="live-dot"></span> ao vivo há 3min
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, lineHeight: 1, letterSpacing: '-0.02em' }}>
                família do caos: a treta do churrasco
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8, fontWeight: 500 }}>
                247 mensagens · 3 áudios · 12 imagens · narrado com vibe leve
              </div>

              {/* waveform + time */}
              <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, minWidth: 42 }}>{fmtTime(progress)}</div>
                <div style={{ flex: 1 }}>
                  <PlayerWave progress={progress} bars={80}/>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, minWidth: 42, opacity: 0.7 }}>18:42</div>
              </div>

              {/* controls */}
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn ghost" style={{ color: '#fff', padding: 10 }} title="voltar 15s">
                  <Ico.Rewind/>
                </button>
                <button
                  onClick={() => setPlaying(!playing)}
                  className="btn"
                  style={{ background: 'var(--lime-500)', width: 56, height: 56, padding: 0, borderRadius: '50%', justifyContent: 'center' }}>
                  {playing ? <Ico.Pause/> : <Ico.Play/>}
                </button>
                <button className="btn ghost" style={{ color: '#fff', padding: 10 }} title="pular 15s">
                  <Ico.Skip/>
                </button>
                <div style={{ flex: 1 }}/>
                <button
                  title="compartilhar"
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(34,197,94,0.5), inset 0 1px 0 rgba(255,255,255,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'; }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                    padding: '11px 18px 11px 14px',
                    background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 999,
                    fontFamily: 'var(--font-body)',
                    fontWeight: 700, fontSize: 13,
                    letterSpacing: '0.01em',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                    transition: 'transform 0.18s cubic-bezier(0.2,0.9,0.3,1.4), box-shadow 0.18s ease',
                  }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)',
                    display: 'grid', placeItems: 'center',
                    backdropFilter: 'blur(4px)',
                  }}>
                    <Ico.Send/>
                  </span>
                  mandar no zap
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <StatCard label="resumos na semana" value="14" accent="lime" icon="🎙"/>
          <StatCard label="minutos ouvidos" value="3h 42m" accent="pink" icon="👂"/>
          <StatCard label="grupos ativos" value="6" accent="yellow" icon="💬"/>
          <StatCard label="taxa aprovação" value="92%" accent="purple" icon="✅"/>
        </div>

        {/* Recent episodes grid */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>
                últimos eps 🔥
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>o que rolou nos seus grupos</div>
            </div>
            <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => onNav('history')}>ver tudo →</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { t: 'vendas sp', s: 'ep. 128', v: 1, d: 'ontem', m: '5:32' },
              { t: 'dev brasil', s: 'ep. 67', v: 2, d: '2d', m: '12:04' },
              { t: 'mães linha de frente', s: 'ep. 201', v: 3, d: '3d', m: '8:15' },
              { t: 'churras do zé', s: 'ep. 14', v: 4, d: '4d', m: '4:50' },
            ].map((ep, i) => (
              <div key={i} style={{ cursor: 'pointer' }} onClick={() => {}}>
                <PodCover title={ep.t} subtitle={ep.s} variant={ep.v} size={220} date={ep.d}/>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{ep.m}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn" style={{ padding: '6px 10px', fontSize: 11 }}><Ico.Play/></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Quick action */}
        <div className="card sprinkle" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -8, right: -8 }}>
            <MicMascot size={72} mood="party"/>
          </div>
          <span className="sticker pink" style={{ marginBottom: 10 }}>✨ bora</span>
          <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 160 }}>
            gerar resumo agora
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
            pega as últimas 24h do grupo e vira um pod de 5 min
          </p>
          <button className="btn purple" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={onGenerate}>
            <Ico.Sparkle/> fazer podcast
          </button>
        </div>

        {/* Approval queue */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>
              aprovar
            </div>
            <span style={{
              background: 'var(--pink-500)', color: '#fff', borderRadius: 999,
              padding: '2px 10px', fontSize: 11, fontWeight: 800, border: '2px solid var(--stroke)',
            }}>2 na fila</span>
          </div>
          {[
            { name: 'vendas sp', status: 'pendente', color: 'var(--yellow-500)' },
            { name: 'dev brasil', status: 'revisar', color: 'var(--pink-500)' },
          ].map((g, i) => (
            <div key={i} onClick={() => onNav('approval')} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px', marginTop: i === 0 ? 0 : 6,
              border: '2px solid var(--stroke)', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)',
              cursor: 'pointer',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.color }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{g.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{g.status}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.4 }}>→</div>
            </div>
          ))}
        </div>

        {/* Tip */}
        <div className="card" style={{ padding: 16, background: 'var(--yellow-500)', color: 'var(--ink-900)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>💡 sacada</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, lineHeight: 1.35 }}>
            grupos com muito áudio rendem podcasts mais longos. ative o filtro de relevância pra cortar os "kkk".
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, icon }) {
  const map = { lime: 'var(--lime-500)', pink: 'var(--pink-500)', yellow: 'var(--yellow-500)', purple: 'var(--purple-600)' };
  const fg = accent === 'purple' || accent === 'pink' ? '#fff' : 'var(--ink-900)';
  return (
    <div style={{
      background: map[accent],
      color: fg,
      border: '2.5px solid var(--stroke)',
      borderRadius: 'var(--r-lg)',
      padding: '14px 16px',
      boxShadow: 'var(--shadow-chunk)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 22, position: 'absolute', top: 8, right: 10, opacity: 0.9 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85 }}>{label}</div>
    </div>
  );
}

Object.assign(window, { HomeScreen });
