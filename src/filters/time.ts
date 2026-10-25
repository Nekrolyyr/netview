/**
 * Time seeker and media filter → one effective time per node (pure functions, unit tested).
 *
 *   no media selected: t_eff = t_act, users without any time activate at t_max
 *   media selected:    t_eff = reach time over the selection (Infinity = not reached, never active)
 *   active             ⇔ t_eff ≤ seeker time
 */

import type { ReachResult } from '../data/types';

export function effectiveTimes(tAct: Float32Array, tMax: number, reach: ReachResult | null,
  out = new Float32Array(tAct.length)): Float32Array {
  if (reach) {
    out.set(reach.time);
    return out;
  }
  for (let i = 0; i < tAct.length; i++) out[i] = Number.isFinite(tAct[i]) ? tAct[i] : tMax;
  return out;
}

/** First index in sorted `arr[lo, hi)` whose value is > x. */
export function upperBound(arr: Float32Array, lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Absorbed users active at time t per host (absorbed times are sorted per host; users without a
 * time count from t_max on, like visible nodes).
 */
export function absorbedActive(offsets: Uint32Array, times: Float32Array, t: number, tMax: number,
  out = new Float32Array(offsets.length - 1)): Float32Array {
  const atEnd = t >= tMax;
  for (let i = 0; i < out.length; i++) {
    const lo = offsets[i];
    const hi = offsets[i + 1];
    if (lo === hi) {
      out[i] = 0;
    } else if (atEnd) {
      out[i] = hi - lo;
    } else {
      out[i] = upperBound(times, lo, hi, t) - lo;
    }
  }
  return out;
}

/** Node radius with the absorbed users active so far. */
export function radiusAt(base: number, k: number, absorbed: Float32Array, out = new Float32Array(absorbed.length)) {
  for (let i = 0; i < absorbed.length; i++) out[i] = base * (1 + k * Math.sqrt(absorbed[i]));
  return out;
}

/**
 * Share of a community's members (each node counted with its absorbed users) that is active.
 * `community[i]` = 0xFFFF for unclustered nodes.
 */
export function communityActivity(community: Uint16Array, tEff: Float32Array, t: number, absorbed: Float32Array,
  absorbedTotal: Uint32Array, sizes: number[]): Float32Array {
  const active = new Float32Array(sizes.length);
  for (let i = 0; i < community.length; i++) {
    const c = community[i];
    if (c === 0xffff || c >= sizes.length) continue;
    if (tEff[i] <= t) active[c] += 1 + Math.min(absorbed[i], absorbedTotal[i]);
  }
  for (let c = 0; c < sizes.length; c++) active[c] = sizes[c] ? Math.min(1, active[c] / sizes[c]) : 0;
  return active;
}

export function countActive(tEff: Float32Array, t: number): number {
  let n = 0;
  for (let i = 0; i < tEff.length; i++) if (tEff[i] <= t) n++;
  return n;
}
