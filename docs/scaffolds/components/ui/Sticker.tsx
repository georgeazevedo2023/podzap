import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Thin wrapper over the global `.sticker` class.
 *
 * Variant maps to color modifier classes (`.sticker.pink`, `.sticker.yellow`,
 * `.sticker.zap`, …). If you need a one-off background/color, leave `variant`
 * undefined and pass a `style` prop — the mockups do both.
 */
export type StickerVariant = 'pink' | 'yellow' | 'lime' | 'purple' | 'zap';

export interface StickerProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StickerVariant;
  children?: ReactNode;
}

export function Sticker({
  variant,
  className,
  children,
  ...rest
}: StickerProps) {
  const classes = ['sticker', variant, className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

export default Sticker;
