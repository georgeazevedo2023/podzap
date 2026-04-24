import type { CSSProperties } from 'react';

/**
 * Chunky styled wrapper around the native <select>.
 *
 * Matches the prototype (see `podZAP/screen_history_schedule.jsx`):
 * pill shape, 2.5px stroke, 2–3px chunky shadow, display font label on top.
 * Native <select> under the hood — keyboard + a11y come free.
 *
 * Tokens used (all from `app/globals.css`):
 *   --surface, --surface-2, --text, --text-dim, --stroke, --accent,
 *   --r-pill, --font-display, --font-body
 */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}

// Inline SVG chevron as data URI — keeps the component self-contained and
// ensures the arrow always matches the stroke color regardless of theme.
// Color is `--text` expressed as `currentColor` in the SVG; we set the parent
// `color` via the select element so `currentColor` resolves correctly.
const CHEVRON_DATA_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23FFFBF2' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>\")";

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  name,
  id,
}: SelectProps) {
  const selectStyle: CSSProperties = {
    width: '100%',
    padding: '10px 38px 10px 14px',
    border: '2.5px solid var(--stroke)',
    borderRadius: 'var(--r-pill)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: 14,
    boxShadow: '2px 2px 0 var(--stroke)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    backgroundImage: CHEVRON_DATA_URI,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 14px center',
    backgroundSize: '14px 14px',
    opacity: disabled ? 0.5 : 1,
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    marginBottom: 8,
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-dim)',
    letterSpacing: '0.01em',
  };

  return (
    <div>
      {label ? (
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
      ) : null}
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = '3px 3px 0 var(--stroke)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = '2px 2px 0 var(--stroke)';
          e.currentTarget.style.borderColor = 'var(--stroke)';
        }}
        style={selectStyle}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default Select;
