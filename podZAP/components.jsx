/* Shared visual components: Mic mascot, Waveform, PodCover, Confetti, Icons */

// ───────────────────────── MIC MASCOT ─────────────────────────
function MicMascot({ size = 80, mood = 'happy', bounce = true }) {
  // mood: happy | sleepy | party | thinking
  const eyeSrc = {
    happy: { l: '^', r: '^' },
    sleepy: { l: '—', r: '—' },
    party: { l: '★', r: '★' },
    thinking: { l: '•', r: '•' },
  }[mood] || { l: '^', r: '^' };

  return (
    <div style={{
      width: size, height: size * 1.2,
      position: 'relative',
      animation: bounce ? 'wiggle 2.8s ease-in-out infinite' : 'none',
      transformOrigin: 'bottom center',
      flexShrink: 0,
    }}>
      <svg viewBox="0 0 100 120" width={size} height={size * 1.2} style={{ overflow: 'visible' }}>
        {/* Stand */}
        <rect x="45" y="95" width="10" height="18" fill="var(--ink-800)" stroke="var(--stroke)" strokeWidth="2.5" rx="2"/>
        <rect x="30" y="110" width="40" height="6" fill="var(--ink-800)" stroke="var(--stroke)" strokeWidth="2.5" rx="3"/>
        {/* Mic body */}
        <rect x="22" y="15" width="56" height="82" rx="28" fill="var(--yellow-500)" stroke="var(--stroke)" strokeWidth="3"/>
        {/* Mic grill lines */}
        <line x1="30" y1="30" x2="70" y2="30" stroke="var(--stroke)" strokeWidth="2" opacity="0.35"/>
        <line x1="30" y1="42" x2="70" y2="42" stroke="var(--stroke)" strokeWidth="2" opacity="0.35"/>
        <line x1="30" y1="54" x2="70" y2="54" stroke="var(--stroke)" strokeWidth="2" opacity="0.35"/>
        {/* Face */}
        <circle cx="38" cy="66" r="4" fill="var(--stroke)"/>
        <circle cx="62" cy="66" r="4" fill="var(--stroke)"/>
        {/* Cheeks */}
        <circle cx="32" cy="76" r="4" fill="var(--pink-500)" opacity="0.6"/>
        <circle cx="68" cy="76" r="4" fill="var(--pink-500)" opacity="0.6"/>
        {/* Smile */}
        <path d="M 42 78 Q 50 86 58 78" stroke="var(--stroke)" strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Hilight */}
        <ellipse cx="34" cy="30" rx="5" ry="10" fill="#fff" opacity="0.5"/>
      </svg>
    </div>
  );
}

// ───────────────────────── WAVEFORM ─────────────────────────
function Waveform({ bars = 48, playing = true, color = 'currentColor', height = 40, seed = 1 }) {
  const heights = React.useMemo(() => {
    // deterministic pseudo-random per seed
    const out = [];
    let s = seed * 9301 + 49297;
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280;
      out.push(0.2 + (s / 233280) * 0.8);
    }
    return out;
  }, [bars, seed]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      height, width: '100%',
    }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${h * 100}%`,
          background: color,
          borderRadius: 2,
          animation: playing ? `wave ${0.6 + (i % 5) * 0.12}s ease-in-out ${i * 0.03}s infinite` : 'none',
          transformOrigin: 'center',
        }}/>
      ))}
    </div>
  );
}

// Static progress waveform for player
function PlayerWave({ progress = 0.3, bars = 80, seed = 2 }) {
  const heights = React.useMemo(() => {
    const out = [];
    let s = seed * 9301 + 49297;
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280;
      // shape: more activity in middle
      const pos = i / bars;
      const envelope = Math.sin(pos * Math.PI) * 0.6 + 0.4;
      out.push((0.2 + (s / 233280) * 0.8) * envelope);
    }
    return out;
  }, [bars, seed]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 56, width: '100%' }}>
      {heights.map((h, i) => {
        const filled = (i / bars) < progress;
        return (
          <div key={i} style={{
            flex: 1,
            height: `${Math.max(h * 100, 8)}%`,
            background: filled ? 'var(--accent-2)' : 'var(--ink-500)',
            opacity: filled ? 1 : 0.4,
            borderRadius: 2,
          }}/>
        );
      })}
    </div>
  );
}

// ───────────────────────── POD COVER ─────────────────────────
// Editorial-style podcast cover with photo + bold typography
function PodCover({ title = 'grupo', subtitle = 'podcast', variant = 0, size = 200, date }) {
  const variants = [
    // Each variant = accent color + photo (unsplash people portraits)
    { accent: '#22C55E', tint: 'rgba(34,197,94,0.08)', photo: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&crop=faces' },
    { accent: '#FF3DA5', tint: 'rgba(255,61,165,0.08)', photo: 'https://images.unsplash.com/photo-1600486913747-55e5470d6f40?w=400&h=400&fit=crop&crop=faces' },
    { accent: '#FFC828', tint: 'rgba(255,200,40,0.08)', photo: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=400&fit=crop&crop=faces' },
    { accent: '#7A3CFF', tint: 'rgba(122,60,255,0.08)', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces' },
    { accent: '#C6FF3C', tint: 'rgba(198,255,60,0.08)', photo: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=faces' },
    { accent: '#1DE9B6', tint: 'rgba(29,233,182,0.08)', photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=faces' },
  ];
  const v = variants[variant % variants.length];

  const isSmall = size <= 80;
  const isMedium = size > 80 && size <= 140;

  return (
    <div style={{
      width: size, height: size,
      background: '#0A0420',
      border: '2px solid var(--stroke)',
      borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-chunk)',
      position: 'relative', overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Photo */}
      <img
        src={v.photo}
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          filter: 'contrast(1.05) saturate(1.1)',
        }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />

      {/* Dark gradient overlay for text contrast */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, rgba(10,4,32,0.15) 0%, rgba(10,4,32,0.35) 45%, rgba(10,4,32,0.92) 100%)`,
      }}/>

      {/* Accent bar bottom-left */}
      <div style={{
        position: 'absolute',
        left: 0, bottom: 0,
        width: '100%',
        height: 3,
        background: v.accent,
      }}/>

      {/* Title block (bottom) */}
      {!isSmall && (
        <div style={{
          position: 'absolute', inset: 0,
          padding: size > 160 ? 16 : 10,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          zIndex: 2,
        }}>
          {/* Small accent line above title */}
          <div style={{
            width: 24, height: 3,
            background: v.accent,
            marginBottom: size > 160 ? 10 : 6,
          }}/>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: size > 160 ? 20 : size > 100 ? 15 : 12,
            color: '#fff',
            lineHeight: 1.0,
            letterSpacing: '-0.02em',
            wordBreak: 'break-word',
            textTransform: 'lowercase',
          }}>
            {title}
          </div>
          {size > 100 && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: size > 160 ? 10 : 9,
              fontWeight: 600,
              color: v.accent,
              marginTop: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}>
              {subtitle}{date ? ` · ${date}` : ''}
            </div>
          )}
        </div>
      )}

      {/* Small variant: just a play icon + tiny label */}
      {isSmall && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, transparent 40%, rgba(10,4,32,0.8) 100%)',
          display: 'flex', alignItems: 'flex-end',
          padding: 6,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10, fontWeight: 800,
            color: '#fff', lineHeight: 1,
            textTransform: 'lowercase',
            letterSpacing: '-0.01em',
          }}>
            {title.split(' ')[0]}
          </div>
        </div>
      )}

      {/* Top-left brand mark — subtle */}
      {size > 140 && (
        <div style={{
          position: 'absolute', top: 12, left: 12,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 9px 4px 7px',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 'var(--r-pill)',
          fontFamily: 'var(--font-body)',
          fontSize: 9, fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#0A0420',
          zIndex: 3,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: v.accent,
          }}/>
          podZAP
        </div>
      )}

      {/* Top-right: duration or date pill for medium+ */}
      {size > 140 && date && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          padding: '3px 8px',
          background: 'rgba(10,4,32,0.6)',
          backdropFilter: 'blur(8px)',
          borderRadius: 'var(--r-pill)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: '#fff',
          border: `1px solid ${v.accent}`,
          zIndex: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {date}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── CONFETTI ─────────────────────────
function Confetti({ active = false }) {
  if (!active) return null;
  const pieces = React.useMemo(() => {
    const colors = ['var(--pink-500)', 'var(--lime-500)', 'var(--yellow-500)', 'var(--purple-600)', 'var(--teal-500)'];
    return [...Array(60)].map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 1.6 + Math.random() * 1.5,
      color: colors[i % colors.length],
      rotate: Math.random() * 360,
      size: 8 + Math.random() * 10,
      shape: i % 3,
    }));
  }, [active]);

  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden',
    }}>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-20vh) rotate(0); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.8; }
        }
      `}</style>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: `${p.left}%`,
          top: 0,
          width: p.size, height: p.shape === 1 ? p.size / 2 : p.size,
          background: p.color,
          borderRadius: p.shape === 2 ? '50%' : 2,
          border: '1.5px solid var(--stroke)',
          animation: `confetti-fall ${p.duration}s ${p.delay}s cubic-bezier(0.3, 0.7, 0.7, 1) forwards`,
          transform: `rotate(${p.rotate}deg)`,
        }}/>
      ))}
    </div>
  );
}

// ───────────────────────── ICONS ─────────────────────────
const Ico = {
  Play: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M7 5v14l12-7z"/></svg>,
  Pause: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>,
  Skip: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M6 5l8 7-8 7V5zM16 5h2v14h-2z"/></svg>,
  Rewind: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M18 19l-8-7 8-7v14zM6 5h2v14H6z"/></svg>,
  Check: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M4 12l6 6L20 6"/></svg>,
  X: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M6 6l12 12M18 6l-12 12"/></svg>,
  Mic: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"/></svg>,
  Group: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><circle cx="9" cy="8" r="3" fill="currentColor"/><circle cx="17" cy="9" r="2.5" fill="currentColor"/><path fill="currentColor" d="M3 20c0-3 3-5 6-5s6 2 6 5v1H3v-1zm12-2c0-1 .5-2 1-2.5C18 15 21 16.5 21 19v1h-6v-2z"/></svg>,
  Calendar: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10z"/></svg>,
  History: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M13 3a9 9 0 00-9 9H1l4 4 4-4H6a7 7 0 117 7 7 7 0 01-4.95-2.05l-1.4 1.4A9 9 0 1013 3z"/><path fill="currentColor" d="M12 7v5l4 2 .75-1.23L13 11V7z"/></svg>,
  Home: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>,
  Sparkle: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg>,
  Edit: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>,
  Refresh: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M17.65 6.35A8 8 0 006.35 17.65L4.93 19.07A10 10 0 1019.07 4.93zM13 7v6l5 3 .75-1.23L14.5 12V7z"/></svg>,
  Send: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>,
  Settings: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M19.14 12.94a7.14 7.14 0 000-1.88l2.03-1.58-2-3.46-2.39.96a7 7 0 00-1.63-.94L14.78 3h-4l-.37 2.54a7 7 0 00-1.63.94l-2.39-.96-2 3.46 2.03 1.58a7.14 7.14 0 000 1.88l-2.03 1.58 2 3.46 2.39-.96a7 7 0 001.63.94l.37 2.54h4l.37-2.54a7 7 0 001.63-.94l2.39.96 2-3.46-2.03-1.58zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/></svg>,
  Wand: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M3 17.25V21h3.75L18 9.75 14.25 6 3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0L15 5.25 18.75 9l1.96-1.96z"/></svg>,
  Volume: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z"/></svg>,
  Bell: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>,
  Plus: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>,
  Chat: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H7l-4 4V6a2 2 0 011-2z"/></svg>,
  Zap: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path fill="currentColor" d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>,
};

// Expose globally
Object.assign(window, { MicMascot, Waveform, PlayerWave, PodCover, Confetti, Ico });
