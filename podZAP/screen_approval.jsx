/* Approval screen — THE main feature */

function ApprovalScreen({ onApprove, onBack }) {
  const [tone, setTone] = React.useState('leve');
  const [editing, setEditing] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [script, setScript] = React.useState(null);
  const [voice, setVoice] = React.useState('ana');

  const defaultScript = `🎙 Aí galera, bem-vindos a mais um episódio do podcast da "Família do Caos"! Hoje foi dia de muita treta e muito amor no grupo — bora recapitular?

O rolê começou quando a Tia Marlene mandou aquele áudio de 7 minutos anunciando o churrasco de domingo. E olha, ninguém tava pronto pra polêmica: Pedrão avisou que tá sem grana e sugeriu dividir. A prima Bia mandou um "kkkk" e virou meme na hora.

No meio da tarde, o Zé postou três fotos do boi que ele comprou — sim, um boi inteiro. A galera surtou, a Duda pediu custas, e o tio Carlos entrou só pra dizer: "o churrasco é meu."

Ah! Teve também o lance do aniversário surpresa da vovó. A Lívia mandou um áudio chorando, emocionada, e todo mundo se comprometeu com uma vaquinha. O total até agora: R$ 1.243. Bora fechar esse presente!

E antes de fechar, o destaque vai pro meme do dia: o Pedrão mandando "tô chegando" às 3 da manhã — foi uma dor de cabeça coletiva.

É isso, família. Domingo tem churrasco, vaquinha tá na mão da Lívia, e o Pedrão? O Pedrão tá chegando. Até o próximo resumo! 🎧`;

  const current = script ?? defaultScript;

  const tones = [
    { id: 'leve', label: '😎 leve', color: 'var(--lime-500)', fg: 'var(--ink-900)' },
    { id: 'divertido', label: '🎉 divertido', color: 'var(--pink-500)', fg: '#fff' },
    { id: 'corporativo', label: '💼 corporativo', color: 'var(--purple-600)', fg: '#fff' },
    { id: 'resenha', label: '🔥 resenha', color: 'var(--yellow-500)', fg: 'var(--ink-900)' },
  ];

  const regen = () => {
    setRegenerating(true);
    setTimeout(() => { setRegenerating(false); setScript(defaultScript + '\n\n[ regenerado com tom "' + tone + '" ]'); }, 1800);
  };

  return (
    <div style={{ padding: '24px 36px 40px', overflowY: 'auto', height: '100%', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
      {/* LEFT — editor */}
      <div>
        {/* Episode header */}
        <div style={{
          background: 'var(--surface)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
          boxShadow: 'var(--shadow-chunk)',
          marginBottom: 18,
          display: 'flex', gap: 18, alignItems: 'center',
        }}>
          <PodCover title="família do caos" subtitle="ep. 42 · draft" variant={0} size={110} date="22 abr"/>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span className="sticker yellow">📝 rascunho</span>
              <span className="sticker" style={{ background: 'var(--bg-2)', color: 'var(--text)' }}>⏱ 4:32 estimado</span>
            </div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              família do caos: a treta do churrasco
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, fontWeight: 500 }}>
              gerado 2min atrás · 247 msgs · 12 imagens · 3 áudios · última atualização 22/04 14:32
            </div>
          </div>
        </div>

        {/* Tone picker */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 10 }}>
            vibe do podcast
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tones.map(t => (
              <button key={t.id} onClick={() => setTone(t.id)} style={{
                padding: '10px 16px',
                background: tone === t.id ? t.color : 'var(--surface)',
                color: tone === t.id ? t.fg : 'var(--text)',
                border: '2.5px solid var(--stroke)',
                borderRadius: 999,
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,
                cursor: 'pointer',
                boxShadow: tone === t.id ? '3px 3px 0 var(--stroke)' : 'none',
                transition: 'all 0.12s',
              }}>{t.label}</button>
            ))}
            <div style={{ flex: 1 }}/>
            <button className="btn ghost" style={{ fontSize: 12 }} onClick={regen} disabled={regenerating}>
              {regenerating ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>🎲</span> remixando...</> : <><Ico.Refresh/> regerar</>}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
          </div>
        </div>

        {/* Script editor */}
        <div style={{
          background: 'var(--surface)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-chunk)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 18px',
            background: 'var(--bg-2)',
            borderBottom: '2px solid var(--stroke)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span className="sticker" style={{ background: 'var(--purple-600)', color: '#fff' }}>
              ✏️ roteiro
            </span>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {current.split(/\s+/).length} palavras · markdown ok
            </div>
            <div style={{ flex: 1 }}/>
            <button className="btn ghost" style={{ fontSize: 11, padding: '6px 10px' }} onClick={() => setEditing(!editing)}>
              <Ico.Edit/> {editing ? 'pré-visualizar' : 'editar'}
            </button>
          </div>

          {editing ? (
            <textarea
              value={current}
              onChange={e => setScript(e.target.value)}
              style={{
                width: '100%', minHeight: 360, padding: 20,
                border: 'none', outline: 'none',
                fontFamily: 'var(--font-body)', fontSize: 14,
                lineHeight: 1.7, color: 'var(--text)',
                background: 'transparent', resize: 'vertical',
              }}
            />
          ) : (
            <div style={{ padding: 22, maxHeight: 360, overflowY: 'auto' }}>
              {current.split('\n\n').map((para, i) => (
                <p key={i} style={{
                  fontSize: 14, lineHeight: 1.7, margin: '0 0 14px',
                  color: 'var(--text)',
                }}>
                  {highlightNames(para)}
                </p>
              ))}
            </div>
          )}

          {regenerating && (
            <div style={{
              padding: '14px 20px', background: 'var(--yellow-500)',
              borderTop: '2px solid var(--stroke)',
              fontSize: 13, fontWeight: 600, color: 'var(--ink-900)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🎲</span>
              remixando com tom "{tone}"... isso leva uns segundinhos
            </div>
          )}
        </div>

        {/* Smart suggestions */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 10 }}>
            ✨ a IA sugere
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              ['encurtar pro ponto', 'resumo em 2min', '🎯'],
              ['adicionar gancho', 'começar com uma pergunta', '🎣'],
              ['tirar os nomes', 'anonimizar o grupo', '🕶️'],
            ].map(([t, d, i], k) => (
              <button key={k} style={{
                textAlign: 'left', padding: 12,
                background: 'var(--surface)',
                border: '2px dashed var(--stroke)',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer', fontFamily: 'var(--font-body)',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--lime-500)'; e.currentTarget.style.borderStyle = 'solid'; e.currentTarget.querySelector('.sug-title').style.color = 'var(--ink-900)'; e.currentTarget.querySelector('.sug-desc').style.color = 'var(--ink-900)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderStyle = 'dashed'; e.currentTarget.querySelector('.sug-title').style.color = 'var(--text)'; e.currentTarget.querySelector('.sug-desc').style.color = 'var(--text-dim)'; }}
              >
                <div style={{ fontSize: 18 }}>{i}</div>
                <div className="sug-title" style={{ fontSize: 13, fontWeight: 800, marginTop: 4, color: 'var(--text)' }}>{t}</div>
                <div className="sug-desc" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{d}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — actions + voice */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Primary actions */}
        <div className="card" style={{ padding: 18, background: 'var(--purple-600)', color: '#fff', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -10, top: -10 }}>
            <MicMascot size={60} mood="happy"/>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', maxWidth: 180 }}>
            tá boladão? bora soltar!
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            aprovando, a gente gera o áudio e já envia pro grupo.
          </div>
          <button className="btn" onClick={onApprove} style={{
            marginTop: 14, width: '100%', justifyContent: 'center',
            background: 'var(--lime-500)', color: 'var(--ink-900)',
          }}>
            <Ico.Check/> aprovar e gerar áudio
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn ghost" style={{ flex: 1, justifyContent: 'center', color: '#fff', fontSize: 12, borderColor: '#fff' }}>
              <Ico.X/> rejeitar
            </button>
            <button className="btn ghost" style={{ flex: 1, justifyContent: 'center', color: '#fff', fontSize: 12, borderColor: '#fff' }}>
              📅 agendar
            </button>
          </div>
        </div>

        {/* Voice picker */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, marginBottom: 10 }}>🎤 voz do narrador</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              { id: 'ana', name: 'Ana', vibe: 'animada, 28 anos', color: 'var(--pink-500)', emoji: '👩🏽' },
              { id: 'carlos', name: 'Carlos', vibe: 'locutor esportivo', color: 'var(--purple-600)', emoji: '👨🏾' },
              { id: 'julia', name: 'Júlia', vibe: 'podcaster chill', color: 'var(--lime-500)', emoji: '👩🏻' },
              { id: 'ze', name: 'Zé', vibe: 'tio divertido', color: 'var(--yellow-500)', emoji: '👨🏻' },
            ].map(v => (
              <button key={v.id} onClick={() => setVoice(v.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 10,
                background: voice === v.id ? v.color : 'var(--bg-2)',
                color: voice === v.id ? (v.id === 'carlos' || v.id === 'ana' ? '#fff' : 'var(--ink-900)') : 'var(--text)',
                border: '2px solid var(--stroke)',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                boxShadow: voice === v.id ? '2px 2px 0 var(--stroke)' : 'none',
                textAlign: 'left', width: '100%',
              }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', border: '2px solid var(--stroke)', display: 'grid', placeItems: 'center', fontSize: 16 }}>{v.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{v.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{v.vibe}</div>
                </div>
                <button style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--ink-900)', color: '#fff',
                  border: '2px solid var(--stroke)',
                  display: 'grid', placeItems: 'center', cursor: 'pointer',
                }} onClick={e => e.stopPropagation()}>
                  <Ico.Play/>
                </button>
              </button>
            ))}
          </div>
        </div>

        {/* Delivery settings */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, marginBottom: 10 }}>📤 entrega</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <Toggle label="enviar no grupo" icon="💬" on={true}/>
            <Toggle label="enviar pra mim" icon="📲" on={true}/>
            <Toggle label="postar no feed" icon="🌐" on={false}/>
            <Toggle label="incluir transcrição" icon="📝" on={true}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function highlightNames(text) {
  const names = ['Tia Marlene', 'Pedrão', 'Bia', 'Zé', 'Duda', 'tio Carlos', 'Lívia', 'vovó'];
  const parts = [];
  let rest = text;
  const pattern = new RegExp(`(${names.join('|')})`, 'g');
  const tokens = rest.split(pattern);
  return tokens.map((t, i) => {
    if (names.includes(t)) {
      return <span key={i} style={{
        background: 'var(--lime-500)', padding: '0 4px', borderRadius: 4,
        fontWeight: 700, border: '1.5px solid var(--stroke)', color: 'var(--ink-900)',
      }}>@{t}</span>;
    }
    return t;
  });
}

function Toggle({ label, icon, on: initial }) {
  const [on, setOn] = React.useState(initial);
  return (
    <div onClick={() => setOn(!on)} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'var(--bg-2)',
      border: '2px solid var(--stroke)',
      borderRadius: 'var(--r-md)',
      cursor: 'pointer',
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{label}</span>
      <div style={{
        width: 38, height: 22, borderRadius: 999,
        background: on ? 'var(--zap-500)' : 'var(--ink-500)',
        border: '2px solid var(--stroke)', padding: 2,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.15s',
          border: '1.5px solid var(--stroke)',
        }}/>
      </div>
    </div>
  );
}

Object.assign(window, { ApprovalScreen });
