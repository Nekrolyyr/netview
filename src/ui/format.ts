/** Formatting helpers for the panels. */

export function formatDate(unix: number | null | undefined, withTime = false): string {
  if (unix == null || !Number.isFinite(unix)) return '–';
  const iso = new Date(unix * 1000).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}

/** Seconds since t0 → date string. */
export function formatRel(t0: number, t: number, withTime = false): string {
  return Number.isFinite(t) ? formatDate(t0 + t, withTime) : 'never';
}

export function compact(n: number | null | undefined): string {
  if (n == null) return '–';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function signed(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '–';
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
}

/** Diverging colour for a sentiment score −5 … +5. */
export function sentimentColour(x: number | null | undefined): string {
  if (x == null) return 'var(--muted)';
  return x >= 0 ? 'var(--positive)' : 'var(--negative)';
}

export const EDGE_LABELS: Record<string, string> = {
  follow: 'follows', like: 'likes', comment: 'comments', reply: 'replies', mention: 'mentions', tag: 'tags',
  coauthor: 'co-author', repost: 'reposts',
};
