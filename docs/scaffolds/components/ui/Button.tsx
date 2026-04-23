import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Thin wrapper over the global `.btn` class defined in globals.css.
 *
 * The variants map to the modifier classes the mockups use: `.btn.purple`,
 * `.btn.pink`, `.btn.zap`, `.btn.ghost`, etc. — color tokens are owned by
 * the CSS, not by this component.
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
  const variantClass = variant === 'default' ? '' : variant;
  const classes = ['btn', variantClass, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export default Button;
