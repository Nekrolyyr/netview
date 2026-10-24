import { describe, expect, it } from 'vitest';

import type { ReachResult } from '../../src/data/types';
import {
  absorbedActive, communityActivity, countActive, effectiveTimes, radiusAt, upperBound,
} from '../../src/filters/time';

describe('effectiveTimes', () => {
  it('uses t_act and activates users without a time at t_max', () => {
    const t = effectiveTimes(new Float32Array([0, 100, Infinity]), 500, null);
    expect(Array.from(t)).toEqual([0, 100, 500]);
  });

  it('uses the reach times when media are selected (unreached never activate)', () => {
    const reach: ReachResult = {
      time: new Float32Array([Infinity, 30, 7]), level: new Uint8Array([0, 2, 1]), direct: 1, hop: 1, absorbed: 0,
    };
    const t = effectiveTimes(new Float32Array([0, 0, 0]), 500, reach);
    expect(Array.from(t)).toEqual([Infinity, 30, 7]);
    expect(countActive(t, 500)).toBe(2);
    expect(countActive(t, 10)).toBe(1);
  });
});

describe('absorbed growth', () => {
  const offsets = new Uint32Array([0, 3, 3, 5]);
  const times = new Float32Array([1, 5, Infinity, 2, 2]);

  it('upperBound finds the first value above x', () => {
    expect(upperBound(times, 0, 3, 0)).toBe(0);
    expect(upperBound(times, 0, 3, 5)).toBe(2);
    expect(upperBound(times, 3, 5, 2)).toBe(5);
  });

  it('counts active absorbed users per host; users without a time count at the end', () => {
    expect(Array.from(absorbedActive(offsets, times, 4, 10))).toEqual([1, 0, 2]);
    expect(Array.from(absorbedActive(offsets, times, 10, 10))).toEqual([3, 0, 2]);
  });

  it('radius grows with the square root of the absorbed users', () => {
    expect(Array.from(radiusAt(1, 0.5, new Float32Array([0, 4])))).toEqual([1, 2]);
  });
});

describe('communityActivity', () => {
  it('is the active share of members, weighted by absorbed users', () => {
    const community = new Uint16Array([0, 0, 1, 0xffff]);
    const tEff = new Float32Array([1, 9, 1, 1]);
    const absorbed = new Float32Array([3, 0, 0, 0]);
    const share = communityActivity(community, tEff, 5, absorbed, new Uint32Array([3, 0, 0, 0]), [5, 1]);
    expect(share[0]).toBeCloseTo(4 / 5);
    expect(share[1]).toBe(1);
  });
});
