/** Media list helpers: filtering, sorting and automatic groups (pure, unit tested). */

import type { MediaInfo } from '../data/types';

export type MediaSort = 'newest' | 'oldest' | 'reach' | 'sentiment' | 'comments';

export interface MediaFilter {
  text: string;
  kind: string;
  from: string;   // YYYY-MM-DD or ''
  to: string;
}

export function filterMedia(media: MediaInfo[], f: MediaFilter, sort: MediaSort): MediaInfo[] {
  const q = f.text.trim().toLowerCase().replace(/^@/, '');
  const from = f.from ? Date.parse(`${f.from}T00:00:00Z`) / 1000 : -Infinity;
  const to = f.to ? Date.parse(`${f.to}T23:59:59Z`) / 1000 : Infinity;
  const out = media.filter((m) => {
    if (f.kind && m.kind !== f.kind) return false;
    if (m.takenAt != null && (m.takenAt < from || m.takenAt > to)) return false;
    if ((f.from || f.to) && m.takenAt == null) return false;
    if (!q) return true;
    return (m.owner ?? '').toLowerCase().includes(q) || (m.code ?? '').toLowerCase().includes(q)
      || (m.caption ?? '').toLowerCase().includes(q);
  });
  const key: Record<MediaSort, (m: MediaInfo) => number> = {
    newest: (m) => -(m.takenAt ?? 0),
    oldest: (m) => m.takenAt ?? Infinity,
    reach: (m) => -(m.directCount + m.hopCount),
    sentiment: (m) => -(m.meanSentiment ?? -99),
    comments: (m) => -(m.comments ?? 0),
  };
  return out.sort((a, b) => key[sort](a) - key[sort](b));
}

export interface AutoGroup {
  id: string;
  name: string;
  media: string[];
}

/** ISO week start (Monday, UTC) of a unix time, as YYYY-MM-DD. */
export function weekOf(unix: number): string {
  const d = new Date(unix * 1000);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function groupsByOwner(media: MediaInfo[]): AutoGroup[] {
  const map = new Map<string, string[]>();
  for (const m of media) {
    const owner = m.owner ?? 'unknown';
    map.set(owner, [...(map.get(owner) ?? []), m.pk]);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([owner, pks]) => ({ id: `owner:${owner}`, name: `@${owner}`, media: pks }));
}

export function groupsByWeek(media: MediaInfo[]): AutoGroup[] {
  const map = new Map<string, string[]>();
  for (const m of media) {
    if (m.takenAt == null) continue;
    const w = weekOf(m.takenAt);
    map.set(w, [...(map.get(w) ?? []), m.pk]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([w, pks]) => ({ id: `week:${w}`, name: `Week of ${w}`, media: pks }));
}

/** Range selection between two positions of the visible list (inclusive). */
export function rangeBetween(list: MediaInfo[], a: string, b: string): string[] {
  const i = list.findIndex((m) => m.pk === a);
  const j = list.findIndex((m) => m.pk === b);
  if (i < 0 || j < 0) return [b];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return list.slice(lo, hi + 1).map((m) => m.pk);
}

export const GROUP_COLOURS = ['#b9a3ff', '#6fd3ff', '#ffd166', '#7ee0a1', '#ff9f6e', '#c4b5fd', '#5eead4', '#a3e635'];
