import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Thin wrapper over the global `.card` class. All the neo-brutalist look
 * (border, shadow, radius) lives in globals.css. This component exists so
 * screen files can write `<Card padding={18}>` instead of repeating inline
 * styles everywhere.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Extra modifier class (e.g. `"sprinkle"`). Added after `.card`. */
  modifier?: string;
  /** Convenience for `style={{ padding }}`. Merged with any explicit `style`. */
  padding?: number | string;
  children?: ReactNode;
}

export function Card({
  modifier,
  padding,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const classes = ['card', modifier, className].filter(Boolean).join(' ');
  const mergedStyle =
    padding === undefined ? style : { padding, ...style };
  return (
    <div className={classes} style={mergedStyle} {...rest}>
      {children}
    </div>
  );
}

export default Card;
