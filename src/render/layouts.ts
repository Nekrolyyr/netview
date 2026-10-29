/**
 * Alternative node positions for the ordered view modes. Pure functions, unit tested.
 *
 * - force:     the analyzer's 3D layout as exported
 * - sentiment: communities along x by their mean sentiment towards the GSF (beeswarm in y), flat in z
 * - radial:    source accounts in the middle; a community is the closer, the larger the share of its
 *              members with a direct link to a source account
 * - ring:      communities on a ring by size (largest at 12 o'clock, clockwise), source accounts inside
 * - sphere:    every node on the surface of a ball; communities keep the directions they have in the 3D
 *              layout (spread apart a little) and become caps that may overlap
 *
 * Communities move as a whole (their members keep their offsets, z flattened). Unclustered nodes follow
 * their already placed neighbours in waves outwards from the communities: a node lands at the mean of its
 * neighbours' new positions plus its compressed old offset from them, so accounts tied to the source
 * accounts and a community sit between the two.
 */

import { FLAG, UNCLUSTERED } from '../data/types';

export type LayoutKind = 'force' | 'sentiment' | 'radial' | 'ring' | 'sphere';

export interface LayoutCommunity {
  centre: [number, number, number];
  radius: number;
  size: number;
  meanSentiment: number | null;
  isSource: boolean;
}

export interface LayoutInput {
  n: number;
  position: Float32Array;
  community: Uint16Array;
  flags: Uint8Array;
  adjOffsets: Uint32Array;
  adjNodes: Uint32Array;
  communities: LayoutCommunity[];
}

/** Drawn on the label canvas: lines and texts in world coordinates. */
export type Guide =
  | { kind: 'line'; a: [number, number, number]; b: [number, number, number] }
  | { kind: 'text'; at: [number, number, number]; text: string; align: 'left' | 'center' | 'right'; strong?: boolean };

export interface Layout {
  kind: LayoutKind;
  /** x, y, z per node */
  position: Float32Array;
  /** new centre per community (members and cloud splats move with it) */
  centres: [number, number, number][];
  /** z factor of the members' offsets from their community centre (1 = unchanged) */
  squash: number;
  guides: Guide[];
  /** the ball of the sphere layout: its radius and one cap per community (unit direction, angular radius) */
  sphere?: { radius: number; caps: SphereCap[] };
}

export interface SphereCap {
  dir: [number, number, number];
  angle: number;
}

/** z of the flat layouts, relative to the 3D layout */
export const SQUASH = 0.3;
/** offset of an unclustered node from its neighbours, relative to the 3D layout */
const COMPRESS = 0.35;

interface Disc {
  x: number;
  y: number;
  r: number;
}

export function forceLayout(input: LayoutInput): Layout {
  return {
    kind: 'force', position: new Float32Array(input.position), squash: 1, guides: [],
    centres: input.communities.map((c) => [...c.centre]),
  };
}

export function computeLayout(kind: LayoutKind, input: LayoutInput): Layout {
  if (kind === 'force') return forceLayout(input);
  if (kind === 'sphere') return sphereLayout(input);
  const { centres, guides } = kind === 'sentiment' ? sentimentPlacement(input.communities)
    : kind === 'radial' ? radialPlacement(input) : ringPlacement(input.communities);
  return { kind, position: placeNodes(input, centres), centres, squash: SQUASH, guides };
}

// ------------------------------------------------------------------ placements
function gapOf(communities: LayoutCommunity[]): number {
  const mean = communities.reduce((s, c) => s + c.radius, 0) / Math.max(1, communities.length);
  return 0.25 * mean;
}

/** Order largest first (stable by id). */
function bySize(communities: LayoutCommunity[]): number[] {
  return communities.map((_, i) => i).sort((a, b) => communities[b].size - communities[a].size || a - b);
}

function overlaps(d: Disc, placed: Disc[], gap: number): boolean {
  return placed.some((p) => Math.hypot(p.x - d.x, p.y - d.y) < p.r + d.r + gap - 1e-6);
}

/** Smallest |y| at which a disc of radius r at x clears every placed disc. */
export function beeswarmY(x: number, r: number, placed: Disc[], gap: number): number {
  const candidates = [0];
  for (const p of placed) {
    const reach = p.r + r + gap;
    const dx = Math.abs(p.x - x);
    if (dx >= reach) continue;
    const dy = Math.sqrt(reach * reach - dx * dx);
    candidates.push(p.y + dy, p.y - dy);
  }
  candidates.sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const y of candidates) if (!overlaps({ x, y, r }, placed, gap)) return y;
  return candidates[candidates.length - 1];
}

function sentimentPlacement(communities: LayoutCommunity[]) {
  const gap = gapOf(communities);
  const rated = communities.map((c) => c.meanSentiment).filter((s): s is number => s !== null && Number.isFinite(s));
  let lo = Math.floor(Math.min(0, ...rated));
  let hi = Math.ceil(Math.max(0, ...rated));
  if (hi - lo < 2) {
    lo = Math.min(lo, -1);
    hi = Math.max(hi, 1);
  }
  const area = communities.reduce((s, c) => s + (2 * c.radius + gap) ** 2, 0);
  const maxR = Math.max(1, ...communities.map((c) => c.radius));
  const width = Math.max(6 * maxR, 1.8 * Math.sqrt(area));
  const xOf = (s: number) => ((s - lo) / (hi - lo) - 0.5) * width;
  const unratedX = width / 2 + 2 * maxR + gap;
  const placed: Disc[] = [];
  const centres: [number, number, number][] = communities.map(() => [0, 0, 0]);
  for (const i of bySize(communities)) {
    const c = communities[i];
    const s = c.meanSentiment;
    const x = s === null || !Number.isFinite(s) ? unratedX : xOf(s);
    const y = beeswarmY(x, c.radius, placed, gap);
    placed.push({ x, y, r: c.radius });
    centres[i] = [x, y, 0];
  }
  const bottom = Math.min(0, ...placed.map((p) => p.y - p.r)) - 2 * gap;
  const tick = Math.max(gap, 0.02 * width);
  const guides: Guide[] = [{ kind: 'line', a: [xOf(lo), bottom, 0], b: [xOf(hi), bottom, 0] }];
  for (let s = lo; s <= hi; s++) {
    const x = xOf(s);
    guides.push({ kind: 'line', a: [x, bottom, 0], b: [x, bottom - tick, 0] });
    guides.push({ kind: 'text', at: [x, bottom - 1.6 * tick, 0], text: s > 0 ? `+${s}` : `${s}`, align: 'center' });
  }
  guides.push(
    { kind: 'text', at: [xOf(lo), bottom - 3.6 * tick, 0], text: '← hostile', align: 'left', strong: true },
    { kind: 'text', at: [xOf(hi), bottom - 3.6 * tick, 0], text: 'supportive →', align: 'right', strong: true },
    { kind: 'text', at: [0, bottom - 5.6 * tick, 0], text: 'mean sentiment of the comments towards the GSF', align: 'center' },
  );
  if (communities.some((c) => c.meanSentiment === null || !Number.isFinite(c.meanSentiment))) {
    guides.push({ kind: 'text', at: [unratedX, bottom - 1.6 * tick, 0], text: 'not rated', align: 'center' });
  }
  return { centres, guides };
}

/** Share of each community's members with a direct link to a source (whitelist) account. */
export function sourceShare(input: LayoutInput): number[] {
  const linked = input.communities.map(() => 0);
  const total = input.communities.map(() => 0);
  const { community, flags, adjOffsets, adjNodes } = input;
  for (let i = 0; i < input.n; i++) {
    const c = community[i];
    if (c === UNCLUSTERED || !input.communities[c]) continue;
    total[c]++;
    for (let k = adjOffsets[i]; k < adjOffsets[i + 1]; k++) {
      if (flags[adjNodes[k]] & FLAG.whitelist) {
        linked[c]++;
        break;
      }
    }
  }
  return linked.map((l, c) => (total[c] ? l / total[c] : 0));
}

function circle(r: number): Guide[] {
  const out: Guide[] = [];
  const steps = 96;
  for (let k = 0; k < steps; k++) {
    const a = (2 * Math.PI * k) / steps;
    const b = (2 * Math.PI * (k + 1)) / steps;
    out.push({ kind: 'line', a: [r * Math.cos(a), r * Math.sin(a), 0], b: [r * Math.cos(b), r * Math.sin(b), 0] });
  }
  return out;
}

function radialPlacement(input: LayoutInput) {
  const { communities } = input;
  const gap = gapOf(communities);
  const share = sourceShare(input);
  const source = communities.findIndex((c) => c.isSource);
  const centres: [number, number, number][] = communities.map(() => [0, 0, 0]);
  const placed: Disc[] = [];
  const maxR = Math.max(1, ...communities.map((c) => c.radius));
  const inner = (source >= 0 ? communities[source].radius : 0) + gap + maxR;
  const area = communities.reduce((s, c) => s + (2 * c.radius + gap) ** 2, 0);
  const span = Math.max(4 * maxR, 1.2 * Math.sqrt(area));
  const rOf = (s: number) => inner + (1 - s) * span;
  if (source >= 0) placed.push({ x: 0, y: 0, r: communities[source].radius });
  // angles from the 3D layout, so related communities stay on the same side
  const mid = [0, 0];
  for (const c of communities) {
    mid[0] += c.centre[0] / communities.length;
    mid[1] += c.centre[1] / communities.length;
  }
  for (const i of bySize(communities)) {
    if (i === source) continue;
    const c = communities[i];
    const theta = Math.atan2(c.centre[1] - mid[1], c.centre[0] - mid[0]);
    let r = rOf(share[i]);
    let spot: Disc | null = null;
    while (!spot) {
      const step = (c.radius + gap) / (2 * r);
      for (let k = 0; k * step <= Math.PI && !spot; k++) {
        for (const sign of k ? [1, -1] : [1]) {
          const a = theta + sign * k * step;
          const d = { x: r * Math.cos(a), y: r * Math.sin(a), r: c.radius };
          if (!overlaps(d, placed, gap)) {
            spot = d;
            break;
          }
        }
      }
      r += c.radius;
    }
    placed.push(spot);
    centres[i] = [spot.x, spot.y, 0];
  }
  const guides: Guide[] = [];
  for (const s of [0.75, 0.5, 0.25, 0]) {
    const r = rOf(s);
    guides.push(...circle(r));
    // on the ring, right of the middle: short, so it rarely meets a community label
    const a = Math.PI / 12;
    guides.push({ kind: 'text', at: [r * Math.cos(a), r * Math.sin(a), 0], text: `${Math.round(s * 100)} %`, align: 'left' });
  }
  const outer = rOf(0) + 0.6 * gap;
  guides.push({ kind: 'text', at: [0, -outer, 0], text: 'rings: share of a community’s members linked directly to a source account', align: 'center' });
  return { centres, guides };
}

function ringPlacement(communities: LayoutCommunity[]) {
  const gap = gapOf(communities);
  const source = communities.findIndex((c) => c.isSource);
  const order = bySize(communities).filter((i) => i !== source);
  const centres: [number, number, number][] = communities.map(() => [0, 0, 0]);
  const arcs = order.map((i) => 2 * communities[i].radius + gap);
  const length = arcs.reduce((s, a) => s + a, 0);
  const maxR = Math.max(1, ...communities.map((c) => c.radius));
  const sourceR = source >= 0 ? communities[source].radius : 0;
  // room inside the ring for the source accounts and the unclustered accounts between them and the ring
  const radius = Math.max(length / (2 * Math.PI), 2.5 * (sourceR + maxR + gap));
  const stretch = (2 * Math.PI * radius) / Math.max(length, 1e-9);
  let arc = 0;
  order.forEach((i, k) => {
    // the largest centred at 12 o'clock, the others clockwise
    const a = Math.PI / 2 - ((arc + arcs[k] / 2 - arcs[0] / 2) * stretch) / radius;
    arc += arcs[k];
    centres[i] = [radius * Math.cos(a), radius * Math.sin(a), 0];
  });
  const guides: Guide[] = [];
  if (order.length) {
    guides.push({ kind: 'text', at: [0, radius + communities[order[0]].radius + gap, 0], text: 'largest ↻', align: 'center', strong: true });
  }
  return { centres, guides };
}

// ------------------------------------------------------------------ nodes
export function placeNodes(input: LayoutInput, centres: [number, number, number][], squash = SQUASH,
                           compress = COMPRESS): Float32Array {
  const { n, position: p, community, communities } = input;
  const out = new Float32Array(3 * n);
  const placed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = community[i];
    const info = communities[c];
    if (c === UNCLUSTERED || !info) continue;
    const to = centres[c];
    out[3 * i] = to[0] + p[3 * i] - info.centre[0];
    out[3 * i + 1] = to[1] + p[3 * i + 1] - info.centre[1];
    out[3 * i + 2] = to[2] + (p[3 * i + 2] - info.centre[2]) * squash;
    placed[i] = 1;
  }
  placeUnclustered(input, out, placed, squash, compress);
  return out;
}

/**
 * Place the nodes not yet ``placed`` (in ``out``) from their placed neighbours, in waves outwards, the
 * nodes with the most placed neighbours first; nodes without a path to any go around the middle.
 */
function placeUnclustered(input: LayoutInput, out: Float32Array, placed: Uint8Array, squash: number,
                          compress: number): void {
  const { n, position: p, adjOffsets, adjNodes } = input;
  // unclustered: waves outwards, nodes with the most placed neighbours first
  for (;;) {
    const wave: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      let k = 0;
      for (let e = adjOffsets[i]; e < adjOffsets[i + 1]; e++) if (placed[adjNodes[e]]) k++;
      if (k) wave.push([k, i]);
    }
    if (!wave.length) break;
    wave.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const done: number[] = [];
    for (const [, i] of wave) {
      const mNew = [0, 0, 0];
      const mOld = [0, 0, 0];
      let k = 0;
      for (let e = adjOffsets[i]; e < adjOffsets[i + 1]; e++) {
        const j = adjNodes[e];
        if (!placed[j]) continue;
        k++;
        for (let d = 0; d < 3; d++) {
          mNew[d] += out[3 * j + d];
          mOld[d] += p[3 * j + d];
        }
      }
      for (let d = 0; d < 3; d++) {
        const off = (p[3 * i + d] - mOld[d] / k) * compress * (d === 2 ? squash : 1);
        out[3 * i + d] = mNew[d] / k + off;
      }
      done.push(i);
    }
    for (const i of done) placed[i] = 1;
  }
  // no path to any community: around the middle of the 3D layout, compressed
  const mid = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) mid[d] += p[3 * i + d] / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue;
    for (let d = 0; d < 3; d++) out[3 * i + d] = (p[3 * i + d] - mid[d]) * compress * (d === 2 ? squash : 1);
  }
}

// ------------------------------------------------------------------ sphere
/** Nodes float just above the ball (their sprites must not sink into it); links run between them and it. */
export const SPHERE_NODE_LIFT = 1.006;
export const SPHERE_LINK_LIFT = 1.003;

type Vec3 = [number, number, number];

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

/** n points spread evenly over the unit sphere (golden spiral), the k-th of them. */
export function fibonacciDir(k: number, n: number): Vec3 {
  const y = 1 - (2 * (k + 0.5)) / Math.max(1, n);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = k * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

function sphereLayout(input: LayoutInput): Layout {
  const { n, communities } = input;
  // caps cover about a third of the ball when nothing overlaps (their area Σ π α² over 4 π)
  const radius = Math.max(1, Math.sqrt(communities.reduce((s, c) => s + c.radius * c.radius, 0) / (4 * 0.3)));
  const mid: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) mid[d] += input.position[3 * i + d] / Math.max(1, n);
  // directions of the 3D layout ...
  const dirs: Vec3[] = communities.map((c, k) => {
    const v: Vec3 = [c.centre[0] - mid[0], c.centre[1] - mid[1], c.centre[2] - mid[2]];
    const l = norm(v);
    return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : fibonacciDir(k, communities.length);
  });
  // ... pushed apart until neighbouring caps overlap at most by a third
  const alpha = communities.map((c) => c.radius / radius);
  for (let round = 0; round < 300; round++) {
    let moved = false;
    for (let a = 0; a < dirs.length; a++) {
      for (let b = a + 1; b < dirs.length; b++) {
        const need = 0.67 * (alpha[a] + alpha[b]);
        const theta = angleBetween(dirs[a], dirs[b]);
        if (theta >= need) continue;
        moved = true;
        const push = (need - theta) / 2;
        for (const [i, j] of [[a, b], [b, a]]) {
          const di = dirs[i];
          const dj = dirs[j];
          const dot = di[0] * dj[0] + di[1] * dj[1] + di[2] * dj[2];
          // away from j, in the tangent plane of i
          let t: Vec3 = [di[0] - dj[0] * dot, di[1] - dj[1] * dot, di[2] - dj[2] * dot];
          if (norm(t) < 1e-9) t = fibonacciDir(i + 1, dirs.length + 2);
          const tl = norm(t);
          const v: Vec3 = [di[0] + (push * t[0]) / tl, di[1] + (push * t[1]) / tl, di[2] + (push * t[2]) / tl];
          const l = norm(v);
          dirs[i] = [v[0] / l, v[1] / l, v[2] / l];
        }
      }
    }
    if (!moved) break;
  }
  // members: inside their cap, 80 % of them within its angular radius; the direction of their offset in the
  // 3D layout is kept, its length scaled to the cap (at most 1.5 times its radius)
  const position = new Float32Array(3 * n);
  const placed = new Uint8Array(n);
  const spread = communities.map((c, k) => {
    const lengths: number[] = [];
    for (let i = 0; i < n; i++) {
      if (input.community[i] !== k) continue;
      lengths.push(Math.hypot(input.position[3 * i] - c.centre[0], input.position[3 * i + 1] - c.centre[1],
        input.position[3 * i + 2] - c.centre[2]));
    }
    lengths.sort((a, b) => a - b);
    return lengths[Math.floor(0.8 * (lengths.length - 1))] || 1;
  });
  for (let i = 0; i < n; i++) {
    const k = input.community[i];
    const c = communities[k];
    if (k === UNCLUSTERED || !c) continue;
    const d = dirs[k];
    const o: Vec3 = [input.position[3 * i] - c.centre[0], input.position[3 * i + 1] - c.centre[1],
      input.position[3 * i + 2] - c.centre[2]];
    const along = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    let t: Vec3 = [o[0] - d[0] * along, o[1] - d[1] * along, o[2] - d[2] * along];
    if (norm(t) < 1e-9) t = [d[1], -d[0], 0];
    if (norm(t) < 1e-9) t = [0, d[2], -d[1]];
    const tl = norm(t);
    const phi = alpha[k] * Math.min(1.5, norm(o) / spread[k]);
    for (let a = 0; a < 3; a++) position[3 * i + a] = (Math.cos(phi) * d[a] + (Math.sin(phi) * t[a]) / tl) * radius;
    placed[i] = 1;
  }
  placeUnclustered(input, position, placed, 1, 0.15);
  const lift = radius * SPHERE_NODE_LIFT;
  for (let i = 0; i < n; i++) {
    let v: Vec3 = [position[3 * i], position[3 * i + 1], position[3 * i + 2]];
    const l = norm(v);
    v = l > 1e-6 * radius ? [v[0] / l, v[1] / l, v[2] / l] : fibonacciDir(i, n);
    position[3 * i] = v[0] * lift;
    position[3 * i + 1] = v[1] * lift;
    position[3 * i + 2] = v[2] * lift;
  }
  // caps where the members ended up: mean direction, 80th percentile of their angles from it
  const caps: SphereCap[] = communities.map((c, k) => {
    const sum: Vec3 = [0, 0, 0];
    const members: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      if (input.community[i] !== k) continue;
      const v: Vec3 = [position[3 * i] / lift, position[3 * i + 1] / lift, position[3 * i + 2] / lift];
      members.push(v);
      for (let d = 0; d < 3; d++) sum[d] += v[d];
    }
    const l = norm(sum);
    const dir: Vec3 = l > 1e-9 ? [sum[0] / l, sum[1] / l, sum[2] / l] : dirs[k];
    const angles = members.map((m) => angleBetween(m, dir)).sort((a, b) => a - b);
    const p80 = angles[Math.floor(0.8 * (angles.length - 1))] ?? 0;
    return { dir, angle: Math.min(1.2, Math.max(0.5 * alpha[k], p80 + 0.15 * alpha[k])) };
  });
  return {
    kind: 'sphere', position, squash: 1, guides: [],
    centres: caps.map((c) => [c.dir[0] * radius, c.dir[1] * radius, c.dir[2] * radius]),
    sphere: { radius, caps },
  };
}

/**
 * Great-circle arc between two points on a ball around the origin, as line segment pairs at ``radius``
 * (about one segment per 7.5°, at most 24).
 */
export function arcPoints(a: ArrayLike<number>, b: ArrayLike<number>, radius: number): Float32Array {
  const ua = [a[0], a[1], a[2]];
  const ub = [b[0], b[1], b[2]];
  const la = Math.hypot(ua[0], ua[1], ua[2]) || 1;
  const lb = Math.hypot(ub[0], ub[1], ub[2]) || 1;
  for (let d = 0; d < 3; d++) {
    ua[d] /= la;
    ub[d] /= lb;
  }
  const theta = angleBetween(ua as Vec3, ub as Vec3);
  const steps = Math.min(24, Math.max(1, Math.ceil(theta / (Math.PI / 24))));
  const sin = Math.sin(theta);
  const point = (t: number): Vec3 => {
    // slerp; nearly identical or opposite ends fall back to a normalised lerp
    const [wa, wb] = sin > 1e-4 ? [Math.sin((1 - t) * theta) / sin, Math.sin(t * theta) / sin] : [1 - t, t];
    const v: Vec3 = [ua[0] * wa + ub[0] * wb, ua[1] * wa + ub[1] * wb, ua[2] * wa + ub[2] * wb];
    const l = norm(v) || 1;
    return [(v[0] / l) * radius, (v[1] / l) * radius, (v[2] / l) * radius];
  };
  const out = new Float32Array(steps * 6);
  let prev = point(0);
  for (let k = 1; k <= steps; k++) {
    const next = point(k / steps);
    out.set(prev, 6 * (k - 1));
    out.set(next, 6 * (k - 1) + 3);
    prev = next;
  }
  return out;
}
