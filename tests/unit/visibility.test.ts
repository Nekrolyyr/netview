import { describe, expect, it } from 'vitest';

import { FLAG } from '../../src/data/types';
import { isLabelled, MODE_LAYOUT, MODE_STYLE, nodeVisibility } from '../../src/filters/visibility';

const flags = new Uint8Array([
  0,                                       // plain member
  FLAG.influencer,                         // clustered influencer
  FLAG.influencer | FLAG.unclustered,      // unclustered influencer
  FLAG.unclustered,                        // unclustered, few followers
  FLAG.whitelist,                          // source account
]);

describe('view modes', () => {
  it('network shows everything', () => {
    expect(Array.from(nodeVisibility('network', flags))).toEqual([1, 1, 1, 1, 1]);
  });

  it('community shows only unclustered accounts with many followers', () => {
    expect(Array.from(nodeVisibility('community', flags))).toEqual([0, 0, 1, 0, 0]);
  });

  it('influencer shows influencers and source accounts', () => {
    expect(Array.from(nodeVisibility('influencer', flags))).toEqual([0, 1, 1, 0, 1]);
  });

  it('the ordered views show every account', () => {
    for (const mode of ['sentiment', 'radial', 'ring', 'sphere'] as const) {
      expect(Array.from(nodeVisibility(mode, flags))).toEqual([1, 1, 1, 1, 1]);
      expect(MODE_LAYOUT[mode]).toBe(mode);
    }
    expect(MODE_LAYOUT.network).toBe('force');
    expect(MODE_STYLE.sphere.clouds).toBe(0);              // the ball paints the communities
  });

  it('only the community view shows sentiment arrows; clouds are faint in the network view', () => {
    expect(MODE_STYLE.community.arrows).toBe(1);
    expect(MODE_STYLE.network.arrows + MODE_STYLE.influencer.arrows).toBe(0);
    expect(MODE_STYLE.network.clouds).toBeLessThan(0.5);
  });

  it('labels go to influencers and source accounts', () => {
    expect(Array.from(flags, isLabelled)).toEqual([false, true, true, false, true]);
  });
});
