/**
 * `formatRelativeTime` — small pt-BR relative-time helper.
 *
 * Used by Fase 10 delivery UI ("entregue há 3 min", "entregue há 2h",
 * "entregue há 1 dia"). Kept dependency-free — we only need a handful of
 * buckets and a single locale, so pulling `Intl.RelativeTimeFormat`
 * (~polished phrasing like "há 3 minutos") is a fine fit for the couple
 * of callsites that need it.
 *
 * Accepts either an ISO string or a `Date`. Returns an empty string when
 * the input is unparseable so callers can render a fallback without a
 * ternary at every site.
 */

const RTF = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

type Bucket = { unit: Intl.RelativeTimeFormatUnit; divisor: number };

/** Ordered coarsest-to-finest; we pick the first bucket that yields ≥1. */
const BUCKETS: readonly Bucket[] = [
  { unit: 'year', divisor: 60 * 60 * 24 * 365 },
  { unit: 'month', divisor: 60 * 60 * 24 * 30 },
  { unit: 'week', divisor: 60 * 60 * 24 * 7 },
  { unit: 'day', divisor: 60 * 60 * 24 },
  { unit: 'hour', divisor: 60 * 60 },
  { unit: 'minute', divisor: 60 },
];

/**
 * Format the delta between `iso` and `now` as a pt-BR relative phrase
 * ("há 3 min", "há 2 horas", "há 1 dia"). Past-only: future timestamps
 * clamp to "agora" since we never show future delivery times.
 */
export function formatRelativeTime(
  iso: string | Date,
  now: Date = new Date(),
): string {
  const then = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const diffSec = Math.round((then.getTime() - now.getTime()) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 45) return 'agora';

  for (const { unit, divisor } of BUCKETS) {
    if (absSec >= divisor) {
      const value = Math.round(diffSec / divisor);
      return RTF.format(value, unit);
    }
  }

  // Below 45s bucket fallthrough would have caught this; belt-and-braces.
  return 'agora';
}
