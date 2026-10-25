import { describe, expect, it } from 'vitest';

import { placeLabels, type LabelCandidate } from '../../src/render/labelPlacement';

const label = (id: number, x: number, y: number, priority: number): LabelCandidate =>
  ({ id, x, y, width: 60, height: 14, priority });

function overlaps(a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number }) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

describe('placeLabels', () => {
  it('keeps the higher priority label of two colliding ones', () => {
    const placed = placeLabels([label(1, 100, 100, 1), label(2, 110, 104, 5)], 800, 600, 10);
    expect(placed.map((p) => p.id)).toEqual([2]);
  });

  it('never places overlapping labels and respects the limit', () => {
    const cands = Array.from({ length: 300 }, (_, i) => label(i, ((i * 37) % 700) + 50, ((i * 53) % 560) + 25, i % 17));
    const placed = placeLabels(cands, 800, 600, 50);
    expect(placed.length).toBeGreaterThan(10);
    expect(placed.length).toBeLessThanOrEqual(50);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
    }
  });

  it('skips labels that do not fit into the view', () => {
    expect(placeLabels([label(1, 5, 100, 1), label(2, 400, 5, 1)], 800, 600, 10)).toEqual([]);
  });
});
