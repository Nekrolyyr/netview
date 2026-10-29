import { describe, expect, it } from 'vitest';

import { FLAG, UNCLUSTERED } from '../../src/data/types';
import {
  arcPoints, beeswarmY, computeLayout, sourceShare, SPHERE_NODE_LIFT, SQUASH, type LayoutInput,
} from '../../src/render/layouts';

/**
 * Community 0 (nodes 0, 1), community 1 (nodes 2, 3), source community 2 (node 4, whitelist).
 * Node 5 is unclustered and linked to 0 and 2; node 6 has no links at all.
 * Nodes 0 and 1 are linked to the source account, node 2 is not.
 */
function input(sentiment: (number | null)[] = [-2, 3, 1]): LayoutInput {
  const links: [number, number][] = [[0, 1], [2, 3], [0, 4], [1, 4], [5, 0], [5, 2]];
  const adj: number[][] = Array.from({ length: 7 }, () => []);
  for (const [a, b] of links) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const offsets = [0];
  for (const a of adj) offsets.push(offsets[offsets.length - 1] + a.length);
  return {
    n: 7,
    position: new Float32Array([
      0, 0, 0, 2, 0, 4,          // community 0 around (1, 0, 2)
      40, 0, 0, 42, 0, 0,        // community 1 around (41, 0, 0)
      20, 30, 0,                 // source
      20, 0, 0,                  // unclustered between 0 and 2
      100, 100, 100,             // isolated
    ]),
    community: new Uint16Array([0, 0, 1, 1, 2, UNCLUSTERED, UNCLUSTERED]),
    flags: new Uint8Array([0, 0, 0, 0, FLAG.whitelist, FLAG.unclustered, FLAG.unclustered]),
    adjOffsets: new Uint32Array(offsets),
    adjNodes: new Uint32Array(adj.flat()),
    communities: [
      { centre: [1, 0, 2], radius: 3, size: 20, meanSentiment: sentiment[0], isSource: false },
      { centre: [41, 0, 0], radius: 2, size: 10, meanSentiment: sentiment[1], isSource: false },
      { centre: [20, 30, 0], radius: 1, size: 1, meanSentiment: sentiment[2], isSource: true },
    ],
  };
}

const at = (p: Float32Array, i: number) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];

describe('layouts', () => {
  it('force keeps the exported positions', () => {
    const l = computeLayout('force', input());
    expect(Array.from(l.position)).toEqual(Array.from(input().position));
    expect(l.squash).toBe(1);
  });

  it('members move with their community and keep their offsets, z flattened', () => {
    const l = computeLayout('sentiment', input());
    const c = l.centres[0];
    expect(at(l.position, 0)[0]).toBeCloseTo(c[0] - 1);
    expect(at(l.position, 1)[0]).toBeCloseTo(c[0] + 1);
    expect(at(l.position, 1)[2] - at(l.position, 0)[2]).toBeCloseTo(4 * SQUASH);
  });

  it('sentiment orders communities from hostile to supportive along x', () => {
    const l = computeLayout('sentiment', input());
    const x = l.centres.map((c) => c[0]);
    expect(x[0]).toBeLessThan(x[2]);                 // −2 < +1
    expect(x[2]).toBeLessThan(x[1]);                 // +1 < +3
    expect(l.guides.some((g) => g.kind === 'text' && g.text.includes('supportive'))).toBe(true);
  });

  it('unrated communities get their own column right of the axis', () => {
    const l = computeLayout('sentiment', input([-2, null, 1]));
    expect(l.centres[1][0]).toBeGreaterThan(Math.max(l.centres[0][0], l.centres[2][0]));
    expect(l.guides.some((g) => g.kind === 'text' && g.text === 'not rated')).toBe(true);
  });

  it('radial puts the source community in the middle and closer communities inside', () => {
    expect(sourceShare(input())).toEqual([1, 0, 0]);
    const l = computeLayout('radial', input());
    const r = l.centres.map((c) => Math.hypot(c[0], c[1]));
    expect(r[2]).toBe(0);
    expect(r[0]).toBeLessThan(r[1]);
  });

  it('ring starts with the largest community at 12 o’clock, source in the middle', () => {
    const l = computeLayout('ring', input());
    const [x, y] = l.centres[0];
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(y).toBeGreaterThan(0);
    expect(l.centres[2]).toEqual([0, 0, 0]);
  });

  it('unclustered nodes land between their neighbours; unlinked ones near the middle', () => {
    for (const kind of ['sentiment', 'radial', 'ring'] as const) {
      const l = computeLayout(kind, input());
      const [x] = at(l.position, 5);
      const a = at(l.position, 0)[0];
      const b = at(l.position, 2)[0];
      expect(x).toBeGreaterThanOrEqual(Math.min(a, b) - 10);
      expect(x).toBeLessThanOrEqual(Math.max(a, b) + 10);
      expect(Array.from(at(l.position, 6)).every(Number.isFinite)).toBe(true);
    }
  });

  it('communities of the flat layouts do not overlap', () => {
    for (const kind of ['sentiment', 'radial', 'ring'] as const) {
      const l = computeLayout(kind, input([1, 1, 1]));
      const { communities } = input();
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          const d = Math.hypot(l.centres[a][0] - l.centres[b][0], l.centres[a][1] - l.centres[b][1]);
          expect(d).toBeGreaterThanOrEqual(communities[a].radius + communities[b].radius);
        }
      }
    }
  });

  it('beeswarm stacks discs at the same x', () => {
    const placed = [{ x: 0, y: 0, r: 1 }];
    expect(Math.abs(beeswarmY(0, 1, placed, 0.5))).toBeCloseTo(2.5);
    expect(beeswarmY(10, 1, placed, 0.5)).toBe(0);
  });

  it('sphere puts every node on the ball, just above its surface', () => {
    const l = computeLayout('sphere', input());
    const r = l.sphere!.radius;
    for (let i = 0; i < 7; i++) expect(Math.hypot(...at(l.position, i))).toBeCloseTo(r * SPHERE_NODE_LIFT, 3);
    for (const c of l.centres) expect(Math.hypot(...c)).toBeCloseTo(r, 3);
  });

  it('sphere caps sit on their members and keep apart', () => {
    const l = computeLayout('sphere', input());
    const { caps } = l.sphere!;
    expect(caps).toHaveLength(3);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const [c, members] of [[0, [0, 1]], [1, [2, 3]]] as const) {
      for (const i of members) {
        const p = at(l.position, i);
        const u = p.map((x) => x / Math.hypot(...p));
        expect(Math.acos(Math.min(1, dot(u, caps[c].dir)))).toBeLessThanOrEqual(caps[c].angle + 1e-6);
      }
    }
    expect(dot(caps[0].dir, caps[1].dir)).toBeLessThan(0.999);
  });

  it('arcs follow the surface between their ends', () => {
    const seg = arcPoints([10, 0, 0], [0, 0, -3], 5);
    expect(seg.length % 6).toBe(0);
    expect(seg.length / 6).toBeGreaterThan(4);                 // 90° → several segments
    for (let k = 0; k < seg.length; k += 3) expect(Math.hypot(seg[k], seg[k + 1], seg[k + 2])).toBeCloseTo(5, 4);
    expect(Array.from(seg.slice(0, 3))).toEqual([5, 0, 0]);
    expect(seg[seg.length - 1]).toBeCloseTo(-5);
    expect(arcPoints([1, 0, 0], [-1, 0, 0], 1).every(Number.isFinite)).toBe(true);   // opposite ends
  });
});
