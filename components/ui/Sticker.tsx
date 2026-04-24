import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Thin wrapper over the global `.sticker` class.
 *
 * Variant maps to the hyphenated modifier classes defined in
 * `app/globals.css`: `.sticker-pink`, `.sticker-yellow`, `.sticker-zap`,
 * `.sticker-purple`. If you need a one-off background/color, leave `variant`
 * undefined and pass a `style` prop — the mockups do both.
 *
 * Historical note: earlier versions emitted `sticker pink` (two classes),
 * which matched the legacy `tokens.css` (`.sticker.pink`) but NOT the
 * Tailwind v4 component layer we shipped in `app/globals.css`. That bug
 * caused all variants to fall through to the default lime background,
 * making the "🔥 plano hype" chip on the sidebar plan card render lime
 * instead of pink. Ported to the hyphen form on 2026-04-24.
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
  const variantClass = variant ? `sticker-${variant}` : undefined;
  const classes = ['sticker', variantClass, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

export default Sticker;
