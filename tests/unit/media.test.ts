import { describe, expect, it } from 'vitest';

import type { MediaInfo } from '../../src/data/types';
import { filterMedia, groupsByOwner, groupsByWeek, rangeBetween, weekOf } from '../../src/ui/mediaGroups';

const m = (pk: string, owner: string, day: string, extra: Partial<MediaInfo> = {}): MediaInfo => ({
  pk, code: pk.toUpperCase(), ownerIdx: 0, owner, kind: 'post', takenAt: Date.parse(`${day}T12:00:00Z`) / 1000,
  caption: `caption ${pk}`, likes: 1, comments: 1, meanSentiment: null, nRated: null, directCount: 0, hopCount: 0,
  absorbedReached: 0, hasThumbnail: false, files: [], ...extra,
});

const media = [
  m('a', 'gsf', '2025-10-01', { directCount: 5 }),
  m('b', 'gsf', '2025-10-03', { kind: 'reel', directCount: 50 }),
  m('c', 'italia', '2025-09-20', { directCount: 1, hopCount: 100 }),
];
const none = { text: '', kind: '', from: '', to: '' };

describe('media list', () => {
  it('filters by text, kind and date range', () => {
    expect(filterMedia(media, { ...none, text: '@ital' }, 'newest').map((x) => x.pk)).toEqual(['c']);
    expect(filterMedia(media, { ...none, kind: 'reel' }, 'newest').map((x) => x.pk)).toEqual(['b']);
    expect(filterMedia(media, { ...none, from: '2025-10-01', to: '2025-10-02' }, 'newest').map((x) => x.pk)).toEqual(['a']);
  });

  it('sorts by date and reach', () => {
    expect(filterMedia(media, none, 'newest').map((x) => x.pk)).toEqual(['b', 'a', 'c']);
    expect(filterMedia(media, none, 'reach').map((x) => x.pk)).toEqual(['c', 'b', 'a']);
  });

  it('builds automatic groups by owner and week', () => {
    expect(groupsByOwner(media)[0]).toMatchObject({ name: '@gsf', media: ['a', 'b'] });
    expect(weekOf(Date.parse('2025-10-03T12:00:00Z') / 1000)).toBe('2025-09-29');
    expect(groupsByWeek(media).map((g) => g.media.length)).toEqual([2, 1]);
  });

  it('selects ranges in list order', () => {
    expect(rangeBetween(media, 'c', 'a')).toEqual(['a', 'b', 'c']);
  });
});
