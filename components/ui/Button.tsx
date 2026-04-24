import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Thin wrapper over the global `.btn` class defined in globals.css.
 *
 * The variants map to the hyphenated modifier classes in
 * `app/globals.css`: `.btn-purple`, `.btn-pink`, `.btn-zap`, `.btn-ghost`,
 * etc. — color tokens are owned by the CSS, not by this component.
 *
 * Historical note: earlier versions emitted `btn purple` (two classes),
 * aligning with the legacy `tokens.css` (`.btn.purple`) but NOT with our
 * Tailwind v4 component layer — variants silently degraded to the default
 * lime fill. Ported to the hyphen form on 2026-04-24.
 */
export type ButtonVariant =
  | 'default'
  | 'purple'
  | 'pink'
  | 'lime'
  | 'yellow'
  | 'zap'
  | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children?: ReactNode;
}

export function Button({
  variant = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const variantClass = variant === 'default' ? '' : `btn-${variant}`;
  const classes = ['btn', variantClass, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export default Button;
