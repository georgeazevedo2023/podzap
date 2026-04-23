/* Onboarding: connect WhatsApp via QR code */

function OnboardingScreen({ onNext }) {
  const [step, setStep] = React.useState(0); // 0=start, 1=qr, 2=connected
  const [scanning, setScanning] = React.useState(false);

  React.useEffect(() => {
    if (step === 1) {
      const t1 = setTimeout(() => setScanning(true), 2000);
      const t2 = setTimeout(() => setStep(2), 4500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [step]);

  return (
    <div style={{ padding: '40px 36px', overflowY: 'auto', height: '100%', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 920, width: '100%' }}>
        {/* Stepper */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {['conectar zap', 'escolher grupos', 'configurar', 'bora!'].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '10px 14px',
              background: i <= step ? 'var(--purple-600)' : 'var(--surface)',
              color: i <= step ? '#fff' : 'var(--text-dim)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--r-pill)',
              fontSize: 12, fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              boxShadow: i === step ? '3px 3px 0 var(--stroke)' : 'none',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: i < step ? 'var(--lime-500)' : i === step ? '#fff' : 'transparent',
                color: 'var(--ink-900)',
                border: '2px solid',
                borderColor: i <= step ? 'var(--stroke)' : 'var(--text-dim)',
                display: 'grid', placeItems: 'center',
                fontSize: 11,
              }}>{i < step ? '✓' : i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 28, alignItems: 'start' }}>
          {/* LEFT */}
          <div>
            {step === 0 && <>
              <span className="sticker zap">🟢 passo 1/4</span>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 56, lineHeight: 0.95, fontWeight: 800, margin: '14px 0 14px', letterSpacing: '-0.03em' }}>
                bora conectar<br/>seu <span style={{ color: 'var(--zap-500)' }}>zap</span>? 📱
              </h1>
              <p style={{ fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.5, maxWidth: 440 }}>
                a gente usa a API oficial (uazapi) pra ler suas mensagens. zero bot estranho, zero print. você autoriza, a gente resume.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn zap" onClick={() => setStep(1)}>
                  <Ico.Zap/> gerar QR code
                </button>
                <button className="btn ghost">como funciona</button>
              </div>
              {/* Features */}
              <div style={{ marginTop: 34, display: 'grid', gap: 10 }}>
                {[
                  ['🔒', 'criptografia end-to-end', 'mensagens nunca saem do servidor sem processar'],
                  ['🎯', 'só os grupos que você quiser', 'nada de ler o zap todo, promessa'],
                  ['⚡', 'setup em 2 minutos', 'sério, é rapidinho'],
                ].map(([i, t, d], k) => (
                  <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: 'var(--lime-500)', border: '2px solid var(--stroke)',
                      display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0,
                      boxShadow: '2px 2px 0 var(--stroke)',
                    }}>{i}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{t}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>}

            {step === 1 && <>
              <span className="sticker yellow">📡 passo 2/4</span>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 48, lineHeight: 0.95, fontWeight: 800, margin: '14px 0 14px', letterSpacing: '-0.03em' }}>
                abre o zap e<br/>aponta a câmera 📸
              </h1>
              <ol style={{ paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 14, marginTop: 20 }}>
                {[
                  'abre o whatsapp no celular',
                  'toca em ⋮ > aparelhos conectados',
                  'toca em "conectar um aparelho"',
                  'aponta pro QR ao lado',
                ].map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: 'var(--purple-600)', color: '#fff',
                      border: '2px solid var(--stroke)', boxShadow: '2px 2px 0 var(--stroke)',
                      display: 'grid', placeItems: 'center', fontFamily: 'var(--font-brand)', fontSize: 14,
                      flexShrink: 0,
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{s}</div>
                  </li>
                ))}
              </ol>
              <div style={{
                marginTop: 24, padding: 14, background: 'var(--yellow-500)',
                border: '2.5px solid var(--stroke)', borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-chunk)', color: 'var(--ink-900)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>⏱ o QR vence em 45s</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>se estourar, a gente gera outro, sem estresse</div>
              </div>
            </>}

            {step === 2 && <>
              <span className="sticker" style={{ background: 'var(--zap-500)', color: '#fff' }}>
                <span className="live-dot"></span> conectado
              </span>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 56, lineHeight: 0.95, fontWeight: 800, margin: '14px 0 14px', letterSpacing: '-0.03em' }}>
                zap<br/><span style={{ color: 'var(--zap-500)' }}>conectado!</span> 🎉
              </h1>
              <div style={{
                padding: 16, background: 'var(--bg-2)',
                border: '2.5px solid var(--stroke)', borderRadius: 'var(--r-md)', marginTop: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '50%',
                    background: 'var(--pink-500)', color: '#fff',
                    border: '2.5px solid var(--stroke)',
                    display: 'grid', placeItems: 'center',
                    fontFamily: 'var(--font-brand)', fontSize: 20,
                    boxShadow: '2px 2px 0 var(--stroke)',
                  }}>JP</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>João Pedro</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>+55 11 9****-1234</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--zap-500)', fontWeight: 800 }}>
                    ● ativo
                  </div>
                </div>
                <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <Stat n="24" l="grupos"/>
                  <Stat n="5,4k" l="msgs hoje"/>
                  <Stat n="128" l="contatos"/>
                </div>
              </div>
              <button className="btn pink" style={{ marginTop: 20 }} onClick={onNext}>
                escolher grupos →
              </button>
            </>}
          </div>

          {/* RIGHT — QR / Phone */}
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <div style={{
              width: 340, aspectRatio: '9/18',
              background: 'var(--ink-900)',
              borderRadius: 36,
              border: '3px solid var(--stroke)',
              boxShadow: 'var(--shadow-chunk-lg)',
              padding: 12,
              position: 'relative',
            }}>
              {/* notch */}
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 100, height: 22, background: '#000', borderRadius: 999, zIndex: 3 }}/>
              <div style={{
                width: '100%', height: '100%',
                background: step === 2 ? 'var(--zap-500)' : 'var(--surface)',
                borderRadius: 26,
                padding: 24,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
                transition: 'background 0.4s ease',
              }}>
                {step === 0 && <PhoneReady/>}
                {step === 1 && <QRDisplay scanning={scanning}/>}
                {step === 2 && <PhoneSuccess/>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 0' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>{n}</div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', fontWeight: 700 }}>{l}</div>
    </div>
  );
}

function PhoneReady() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--text)' }}>
      <div style={{ fontSize: 60, marginBottom: 10 }}>📱</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
        seu zap<br/>espera por aí
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
        clica em "gerar QR code"
      </div>
    </div>
  );
}

function QRDisplay({ scanning }) {
  // fake QR pattern
  const cells = React.useMemo(() => {
    const n = 21;
    const out = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let on = ((r * 37 + c * 19 + r * c) % 3) === 0;
        // corners
        const inCorner = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        if (inCorner) {
          const rr = r < 7 ? r : n - 1 - r;
          const cc = c < 7 ? c : n - 1 - c;
          on = (rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4));
        }
        out.push(on);
      }
    }
    return out;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--ink-900)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zap-500)' }}>
        🟢 whatsapp web
      </div>
      <div style={{
        width: 220, height: 220, background: '#fff',
        border: '3px solid var(--stroke)', borderRadius: 16,
        padding: 10, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(21, 1fr)`,
          width: '100%', height: '100%', gap: 1,
        }}>
          {cells.map((on, i) => (
            <div key={i} style={{ background: on ? '#000' : 'transparent' }}/>
          ))}
        </div>
        {/* center logo */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 40, height: 40, background: 'var(--zap-500)', border: '2.5px solid #fff',
          borderRadius: 10, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 20,
        }}>💬</div>
        {/* scan line */}
        {scanning && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 0,
            height: 4, background: 'var(--zap-500)', boxShadow: '0 0 12px var(--zap-500)',
            animation: 'scan 1.2s ease-in-out infinite',
          }}/>
        )}
        <style>{`@keyframes scan { 0% { top: 0; } 100% { top: 100%; } }`}</style>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-700)' }}>
        {scanning ? 'lendo…' : 'aguardando scan'}
      </div>
    </div>
  );
}

function PhoneSuccess() {
  return (
    <div style={{ textAlign: 'center', color: '#fff' }}>
      <div style={{ fontSize: 80, marginBottom: 6 }}>✅</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.02em' }}>
        conectado,<br/>parça!
      </div>
      <div style={{ fontSize: 12, opacity: 0.9, marginTop: 10 }}>
        agora vem a parte divertida
      </div>
    </div>
  );
}

Object.assign(window, { OnboardingScreen });
