/**
 * Microphone mascot SVG with 4 moods. Animation uses the `wiggle` keyframes
 * declared in globals.css — no client interactivity, so this stays a server
 * component.
 *
 * Ported 1:1 from `podZAP/components.jsx` MicMascot.
 */
export type MicMood = 'happy' | 'sleepy' | 'party' | 'thinking';

export type MicMascotProps = {
  size?: number;
  mood?: MicMood;
  bounce?: boolean;
};

export function MicMascot({
  size = 80,
  mood: _mood = 'happy',
  bounce = true,
}: MicMascotProps): React.ReactElement {
  // `mood` is parsed but not yet visually differentiated — the prototype
  // defined eye glyphs per mood but used the same circle rendering for all
  // variants. Keep the prop surface so consumers can pass intent; wire up
  // mood-specific eye shapes later.
  void _mood;

  return (
    <div
      style={{
        width: size,
        height: size * 1.2,
        position: 'relative',
        animation: bounce ? 'wiggle 2.8s ease-in-out infinite' : 'none',
        transformOrigin: 'bottom center',
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 100 120"
        width={size}
        height={size * 1.2}
        style={{ overflow: 'visible' }}
      >
        {/* Stand */}
        <rect
          x="45"
          y="95"
          width="10"
          height="18"
          fill="var(--color-ink-800)"
          stroke="var(--color-stroke)"
          strokeWidth="2.5"
          rx="2"
        />
        <rect
          x="30"
          y="110"
          width="40"
          height="6"
          fill="var(--color-ink-800)"
          stroke="var(--color-stroke)"
          strokeWidth="2.5"
          rx="3"
        />
        {/* Mic body */}
        <rect
          x="22"
          y="15"
          width="56"
          height="82"
          rx="28"
          fill="var(--color-yellow-500)"
          stroke="var(--color-stroke)"
          strokeWidth="3"
        />
        {/* Mic grill lines */}
        <line
          x1="30"
          y1="30"
          x2="70"
          y2="30"
          stroke="var(--color-stroke)"
          strokeWidth="2"
          opacity="0.35"
        />
        <line
          x1="30"
          y1="42"
          x2="70"
          y2="42"
          stroke="var(--color-stroke)"
          strokeWidth="2"
          opacity="0.35"
        />
        <line
          x1="30"
          y1="54"
          x2="70"
          y2="54"
          stroke="var(--color-stroke)"
          strokeWidth="2"
          opacity="0.35"
        />
        {/* Eyes */}
        <circle cx="38" cy="66" r="4" fill="var(--color-stroke)" />
        <circle cx="62" cy="66" r="4" fill="var(--color-stroke)" />
        {/* Cheeks */}
        <circle
          cx="32"
          cy="76"
          r="4"
          fill="var(--color-pink-500)"
          opacity="0.6"
        />
        <circle
          cx="68"
          cy="76"
          r="4"
          fill="var(--color-pink-500)"
          opacity="0.6"
        />
        {/* Smile */}
        <path
          d="M 42 78 Q 50 86 58 78"
          stroke="var(--color-stroke)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        {/* Highlight */}
        <ellipse cx="34" cy="30" rx="5" ry="10" fill="#fff" opacity="0.5" />
      </svg>
    </div>
  );
}

export default MicMascot;
