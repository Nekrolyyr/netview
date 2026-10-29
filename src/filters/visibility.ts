/** Which elements each view mode shows (plan §4). Pure functions, unit tested. */

import { FLAG } from '../data/types';
import type { LayoutKind } from '../render/layouts';

export type ViewMode = 'network' | 'community' | 'influencer' | 'sentiment' | 'radial' | 'ring' | 'sphere';

/** Node positions per mode: the exported 3D layout or one of the ordered, flat layouts. */
export const MODE_LAYOUT: Record<ViewMode, LayoutKind> = {
  network: 'force', community: 'force', influencer: 'force', sentiment: 'sentiment', radial: 'radial', ring: 'ring',
  sphere: 'sphere',
};

export interface ModeStyle {
  edges: number;      // edge layer opacity
  clouds: number;     // cloud layer opacity
  arrows: number;     // sentiment arrows opacity
}

export const MODE_STYLE: Record<ViewMode, ModeStyle> = {
  network: { edges: 1, clouds: 0.18, arrows: 0 },
  community: { edges: 0, clouds: 1, arrows: 1 },
  influencer: { edges: 0, clouds: 1, arrows: 0 },
  sentiment: { edges: 1, clouds: 1, arrows: 0 },
  radial: { edges: 1, clouds: 1, arrows: 0 },
  ring: { edges: 1, clouds: 1, arrows: 0 },
  // the ball paints the communities itself
  sphere: { edges: 0.3, clouds: 0, arrows: 0 },
};

/** 1 = visible, 0 = hidden, per node. */
export function nodeVisibility(mode: ViewMode, flags: Uint8Array, out = new Float32Array(flags.length)): Float32Array {
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    let v: boolean;
    if (mode === 'network' || MODE_LAYOUT[mode] !== 'force') v = true;
    else if (mode === 'community') v = (f & FLAG.unclustered) !== 0 && (f & FLAG.influencer) !== 0;
    else v = (f & (FLAG.influencer | FLAG.whitelist)) !== 0;
    out[i] = v ? 1 : 0;
  }
  return out;
}

/** Nodes that may carry a label: influencers and whitelist (source) accounts. */
export function isLabelled(flag: number): boolean {
  return (flag & (FLAG.influencer | FLAG.whitelist)) !== 0;
}
