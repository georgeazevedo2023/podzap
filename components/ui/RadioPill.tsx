'use client';

import type { CSSProperties } from 'react';

/**
 * Pill-shaped radio group. Renders N options side-by-side (wraps on small
 * screens); the selected one is filled with `--accent`, others are outlined.
 *
 * Uses native <input type="radio"> (visually hidden) + <label> so keyboard
 * navigation and screen readers work. The whole label is clickable.
 *
 * Generic over `T extends string` so consumers get literal-type safety on
 * both `value` and `onChange`.
 *
 * Tokens used (all from `app/globals.css`):
 *   --accent, --text, --text-dim, --text-inv, --stroke, --surface,
 *   --r-pill, --font-body, --font-display
 */
export interface RadioPillOption<T extends string> {
  value: T;
  label: string;
  emoji?: string;
}

export interface RadioPillProps<T extends string> {
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioPillOption<T>[];
  name: string;
}

export function RadioPill<T extends string>({
  label,
  value,
  onChange,
  options,
  name,
}: RadioPillProps<T>) {
  const groupLabelStyle: CSSProperties = {
    display: 'block',
    marginBottom: 8,
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-dim)',
    letterSpacing: '0.01em',
  };

  const rowStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  };

  // Native inputs are visually hidden but remain focusable / in the
  // accessibility tree. The sibling <span> is what the user sees.
  const hiddenInputStyle: CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  };

  return (
    <div role="radiogroup" aria-label={label}>
      {label ? <span style={groupLabelStyle}>{label}</span> : null}
      <div style={rowStyle}>
        {options.map((opt) => {
          const checked = opt.value === value;
          const pillStyle: CSSProperties = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 'var(--r-pill)',
            border: '2px solid var(--stroke)',
            background: checked ? 'var(--accent)' : 'transparent',
            color: checked ? 'var(--text-inv)' : 'var(--text-dim)',
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.01em',
            cursor: 'pointer',
            boxShadow: checked ? '2px 2px 0 var(--stroke)' : 'none',
            userSelect: 'none',
            transition: 'background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
            whiteSpace: 'nowrap',
          };

          return (
            <label
              key={opt.value}
              style={pillStyle}
              onMouseEnter={(e) => {
                if (!checked) {
                  e.currentTarget.style.background = 'var(--surface)';
                  e.currentTarget.style.color = 'var(--text)';
                }
              }}
              onMouseLeave={(e) => {
                if (!checked) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-dim)';
                }
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
                style={hiddenInputStyle}
              />
              {opt.emoji ? <span aria-hidden="true">{opt.emoji}</span> : null}
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default RadioPill;
