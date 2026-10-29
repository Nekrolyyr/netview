/** The scene layers: nodes (points), edges (line segments), community clouds (splats), sentiment arrows. */

import * as THREE from 'three';

import type { Graph } from '../data/graph';
import { FLAG, UNCLUSTERED, type CommunityInfo, type SentimentLink } from '../data/types';
import { arcPoints, type SphereCap } from './layouts';
import {
  ballFragment, ballVertex, cloudFragment, cloudVertex, compositeFragment, compositeVertex, edgeFragment, edgeVertex,
  nodeFragment, nodeVertex, pickFragment, pickVertex,
} from './shaders';

export function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color();
  c.setStyle(hex, THREE.NoColorSpace);
  return [c.r, c.g, c.b];
}

/** Node fill: the colour of its community; unclustered accounts are white. */
export function nodeColours(graph: Graph): Float32Array {
  const white = rgb(graph.data.meta.colours.other ?? '#f2f0f5');
  const fills = graph.data.communities.map((c) => rgb(c.colour));
  const community = graph.arrays.community;
  const out = new Float32Array(graph.n * 3);
  for (let i = 0; i < graph.n; i++) {
    out.set(community[i] === UNCLUSTERED ? white : fills[community[i]] ?? white, 3 * i);
  }
  return out;
}

/** Ring per node: 2 = whitelist (bright red) > 1 = influencer (pink) > 0 = none. */
export function nodeRoles(flags: Uint8Array): Float32Array {
  return Float32Array.from(flags, (f) => (f & FLAG.whitelist ? 2 : f & FLAG.influencer ? 1 : 0));
}

export class NodesLayer {
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  readonly pickMaterial: THREE.ShaderMaterial;
  readonly pickPoints: THREE.Points;
  readonly colours: Float32Array;

  constructor(readonly graph: Graph) {
    const n = graph.n;
    const g = this.geometry;
    // a copy: the layouts move the nodes, the bundle keeps the exported positions
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(graph.arrays.position), 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(graph.arrays.radius), 1));
    this.colours = nodeColours(graph);
    g.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 3));
    g.setAttribute('aRole', new THREE.BufferAttribute(nodeRoles(graph.arrays.flags), 1));
    g.setAttribute('aTeff', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aVisFrom', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute('aVisTo', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute('aHighlight', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aId', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    g.computeBoundingSphere();
    const uniforms = {
      uTime: { value: 0 },
      uMix: { value: 1 },
      uProjScale: { value: 1 },
      uSizeScale: { value: 1 },
      uFocus: { value: 0 },
      uDim: { value: 0.22 },
      uLod: { value: 1 },
      uRingWhitelist: { value: new THREE.Vector3(...rgb(graph.data.meta.colours.whitelist ?? '#ff2a2a')) },
      uRingInfluencer: { value: new THREE.Vector3(...rgb(graph.data.meta.colours.influencer ?? '#ff5fc8')) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: nodeVertex, fragmentShader: nodeFragment, uniforms,
      transparent: true, depthWrite: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.pickMaterial = new THREE.ShaderMaterial({
      vertexShader: pickVertex, fragmentShader: pickFragment,
      uniforms: { uMix: uniforms.uMix, uProjScale: { value: 1 }, uSizeScale: uniforms.uSizeScale },
    });
    this.pickPoints = new THREE.Points(g, this.pickMaterial);
    this.pickPoints.frustumCulled = false;
  }

  attr(name: string): THREE.BufferAttribute {
    return this.geometry.getAttribute(name) as THREE.BufferAttribute;
  }

  set(name: string, values: ArrayLike<number>): void {
    const a = this.attr(name);
    (a.array as Float32Array).set(values);
    a.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.pickMaterial.dispose();
  }
}

/**
 * Links as straight segments, or (sphere layout) as great-circle arcs along the ball: the arcs are a second
 * geometry with the same material, so type mask, opacity, focus, time and level of detail apply to both.
 */
export class EdgesLayer {
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly lines: THREE.LineSegments;
  readonly arcs: THREE.LineSegments;
  private arcGeometry = new THREE.BufferGeometry();
  /** link of every arc vertex */
  private arcEdge = new Uint32Array(0);
  private arcMode = false;
  private edgeTime: Float32Array;
  private edgeHighlight: Uint8Array;

  constructor(readonly graph: Graph, private nodeColour: Float32Array) {
    const { edge_src, edge_dst, edge_types, position } = graph.arrays;
    const m = edge_src.length;
    const pos = new Float32Array(m * 6);
    const col = new Float32Array(m * 6);
    const types = new Float32Array(m * 2);
    for (let e = 0; e < m; e++) {
      const a = edge_src[e];
      const b = edge_dst[e];
      for (let k = 0; k < 3; k++) {
        pos[6 * e + k] = position[3 * a + k];
        pos[6 * e + 3 + k] = position[3 * b + k];
        // mix of both endpoint colours, slightly weighted to each end
        col[6 * e + k] = 0.7 * nodeColour[3 * a + k] + 0.3 * nodeColour[3 * b + k];
        col[6 * e + 3 + k] = 0.3 * nodeColour[3 * a + k] + 0.7 * nodeColour[3 * b + k];
      }
      types[2 * e] = types[2 * e + 1] = edge_types[e];
    }
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColour', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTypes', new THREE.BufferAttribute(types, 1));
    g.setAttribute('aTeff', new THREE.BufferAttribute(new Float32Array(m * 2), 1));
    g.setAttribute('aHighlight', new THREE.BufferAttribute(new Float32Array(m * 2), 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: edgeVertex, fragmentShader: edgeFragment,
      uniforms: {
        uTime: { value: 0 }, uTypeMask: { value: 0xff }, uOpacity: { value: 1 }, uFocus: { value: 0 }, uLod: { value: 1 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.arcs = new THREE.LineSegments(this.arcGeometry, this.material);
    this.arcs.frustumCulled = false;
    this.arcs.renderOrder = 1;
    this.arcs.visible = false;
    this.edgeTime = new Float32Array(m);
    this.edgeHighlight = new Uint8Array(m);
  }

  /** Build the arcs between the given node positions on a ball around the origin. */
  buildArcs(node: Float32Array, radius: number): void {
    const { edge_src, edge_dst, edge_types } = this.graph.arrays;
    const pieces: Float32Array[] = [];
    let vertices = 0;
    for (let e = 0; e < edge_src.length; e++) {
      const a = 3 * edge_src[e];
      const b = 3 * edge_dst[e];
      const piece = arcPoints(node.subarray(a, a + 3), node.subarray(b, b + 3), radius);
      pieces.push(piece);
      vertices += piece.length / 3;
    }
    const pos = new Float32Array(vertices * 3);
    const col = new Float32Array(vertices * 3);
    const types = new Float32Array(vertices);
    this.arcEdge = new Uint32Array(vertices);
    const c = this.nodeColour;
    let v = 0;
    pieces.forEach((piece, e) => {
      const a = 3 * edge_src[e];
      const b = 3 * edge_dst[e];
      const n = piece.length / 3;
      pos.set(piece, 3 * v);
      for (let k = 0; k < n; k++) {
        // vertex pairs (2s, 2s + 1) are the ends of segment s: the colour runs from one end to the other
        const t = (Math.floor(k / 2) + (k % 2)) / (n / 2);
        const wa = 0.7 - 0.4 * t;
        for (let d = 0; d < 3; d++) col[3 * (v + k) + d] = wa * c[a + d] + (1 - wa) * c[b + d];
        types[v + k] = edge_types[e];
        this.arcEdge[v + k] = e;
      }
      v += n;
    });
    const g = this.arcGeometry;
    g.dispose();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColour', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTypes', new THREE.BufferAttribute(types, 1));
    g.setAttribute('aTeff', new THREE.BufferAttribute(new Float32Array(vertices), 1));
    g.setAttribute('aHighlight', new THREE.BufferAttribute(new Float32Array(vertices), 1));
    this.writeArcs();
  }

  /** Arcs instead of straight lines (once ``buildArcs`` ran). */
  setArcMode(on: boolean): void {
    const visible = this.lines.visible || this.arcs.visible;
    this.arcMode = on && this.arcEdge.length > 0;
    this.setVisible(visible);
  }

  setVisible(visible: boolean): void {
    this.lines.visible = visible && !this.arcMode;
    this.arcs.visible = visible && this.arcMode;
  }

  /** Copy the per-link time and highlight onto the arc vertices. */
  private writeArcs(): void {
    if (!this.arcEdge.length) return;
    const t = this.arcGeometry.getAttribute('aTeff') as THREE.BufferAttribute;
    const h = this.arcGeometry.getAttribute('aHighlight') as THREE.BufferAttribute;
    const ta = t.array as Float32Array;
    const ha = h.array as Float32Array;
    for (let v = 0; v < this.arcEdge.length; v++) {
      ta[v] = this.edgeTime[this.arcEdge[v]];
      ha[v] = this.edgeHighlight[this.arcEdge[v]];
    }
    t.needsUpdate = true;
    h.needsUpdate = true;
  }

  /** Move the line ends to the given node positions (x, y, z per node). */
  setPositions(node: Float32Array): void {
    const { edge_src, edge_dst } = this.graph.arrays;
    const a = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = a.array as Float32Array;
    for (let e = 0; e < edge_src.length; e++) {
      const s = 3 * edge_src[e];
      const d = 3 * edge_dst[e];
      pos[6 * e] = node[s];
      pos[6 * e + 1] = node[s + 1];
      pos[6 * e + 2] = node[s + 2];
      pos[6 * e + 3] = node[d];
      pos[6 * e + 4] = node[d + 1];
      pos[6 * e + 5] = node[d + 2];
    }
    a.needsUpdate = true;
  }

  setHighlight(edges: Set<number>): void {
    const a = this.geometry.getAttribute('aHighlight') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    arr.fill(0);
    this.edgeHighlight.fill(0);
    for (const e of edges) {
      arr[2 * e] = arr[2 * e + 1] = 1;
      this.edgeHighlight[e] = 1;
    }
    a.needsUpdate = true;
    this.writeArcs();
  }

  /** Edge activation = the later of its endpoints' effective times. */
  setTimes(tEff: Float32Array): void {
    const { edge_src, edge_dst } = this.graph.arrays;
    const a = this.geometry.getAttribute('aTeff') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let e = 0; e < edge_src.length; e++) {
      arr[2 * e] = arr[2 * e + 1] = this.edgeTime[e] = Math.max(tEff[edge_src[e]], tEff[edge_dst[e]]);
    }
    a.needsUpdate = true;
    this.writeArcs();
  }

  dispose(): void {
    this.geometry.dispose();
    this.arcGeometry.dispose();
    this.material.dispose();
  }
}

/** Accumulated weight at a cloud's centre (coverage there = 1 − e^(−density · peak), see CloudComposite). */
const CLOUD_PEAK = 1.0;

/**
 * Summed splat intensity at the cloud centre (viewed along any axis): used to give every cloud the
 * same peak, whatever its number and size of splats.
 */
export function centreCoverage(c: CommunityInfo): number {
  let sum = 0;
  const [cx, cy, cz] = c.centre;
  for (let s = 0; s < c.splats.length; s += 4) {
    const r = c.splats[s + 3];
    // distance perpendicular to a random view axis is ~ sqrt(2/3) of the 3D distance
    const d = Math.hypot(c.splats[s] - cx, c.splats[s + 1] - cy, c.splats[s + 2] - cz) * Math.sqrt(2 / 3);
    const d2 = (d * d) / (r * r);
    if (d2 < 1) sum += Math.exp(-3.2 * d2) * (1 - d2);
  }
  return sum;
}

export class CloudsLayer {
  readonly geometry = new THREE.InstancedBufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private community: Uint16Array;
  private colours: Float32Array;
  /** splat centres of the exported layout */
  private base: Float32Array;

  constructor(readonly communities: CommunityInfo[]) {
    const total = communities.reduce((s, c) => s + c.splats.length / 4, 0);
    const centre = new Float32Array(total * 3);
    const radius = new Float32Array(total);
    const colour = new Float32Array(total * 3);
    const weight = new Float32Array(total);
    this.community = new Uint16Array(total);
    let k = 0;
    for (const c of communities) {
      const n = c.splats.length / 4;
      const col = rgb(c.colour);
      const w = CLOUD_PEAK / Math.max(1e-6, centreCoverage(c));
      for (let s = 0; s < n; s++, k++) {
        centre.set(c.splats.subarray(4 * s, 4 * s + 3), 3 * k);
        radius[k] = c.splats[4 * s + 3];
        colour.set(col, 3 * k);
        weight[k] = w;
        this.community[k] = c.id;
      }
    }
    this.colours = colour;
    this.base = new Float32Array(centre);
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iCentre', new THREE.InstancedBufferAttribute(centre, 3));
    g.setAttribute('iRadius', new THREE.InstancedBufferAttribute(radius, 1));
    g.setAttribute('iColour', new THREE.InstancedBufferAttribute(colour, 3));
    g.setAttribute('iWeight', new THREE.InstancedBufferAttribute(weight, 1));
    g.setAttribute('iActivity', new THREE.InstancedBufferAttribute(new Float32Array(total).fill(1), 1));
    g.instanceCount = total;
    this.material = new THREE.ShaderMaterial({
      vertexShader: cloudVertex, fragmentShader: cloudFragment,
      uniforms: { uOpacity: { value: 0.2 } },
      // accumulated additively into the offscreen cloud buffer (colour and weight), see CloudComposite
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  /** Activity (0 … 1) per community: share of its members that are active. */
  setActivity(activity: Float32Array): void {
    const a = this.geometry.getAttribute('iActivity') as THREE.InstancedBufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < arr.length; k++) arr[k] = activity[this.community[k]] ?? 1;
    a.needsUpdate = true;
  }

  /**
   * Move every cloud to a new centre: splat = centre + (exported splat − exported centre), its z offset
   * scaled by ``squash`` (the flat layouts).
   */
  place(centres: ArrayLike<number>[], squash: number): void {
    const a = this.geometry.getAttribute('iCentre') as THREE.InstancedBufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < this.community.length; k++) {
      const c = this.communities[this.community[k]];
      const to = centres[this.community[k]];
      if (!c || !to) continue;
      arr[3 * k] = to[0] + this.base[3 * k] - c.centre[0];
      arr[3 * k + 1] = to[1] + this.base[3 * k + 1] - c.centre[1];
      arr[3 * k + 2] = to[2] + (this.base[3 * k + 2] - c.centre[2]) * squash;
    }
    a.needsUpdate = true;
  }

  /** Brighten the selected community, fade the others far back. */
  setFocus(selected: number | null): void {
    const a = this.geometry.getAttribute('iColour') as THREE.InstancedBufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < this.community.length; k++) {
      const f = selected === null || this.community[k] === selected ? 1 : 0.1;
      for (let j = 0; j < 3; j++) arr[3 * k + j] = this.colours[3 * k + j] * f;
    }
    a.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Offscreen accumulation of the clouds (half resolution, half float) and the full-screen pass that
 * composites the average colour by coverage behind links and nodes.
 */
export class CloudComposite {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  readonly scene = new THREE.Scene();
  readonly quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: compositeVertex, fragmentShader: compositeFragment,
      uniforms: { tCloud: { value: this.target.texture }, uDensity: { value: 1.2 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -10;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }

  /** Accumulate the clouds of ``clouds`` into the target (call before rendering the main scene). */
  render(renderer: THREE.WebGLRenderer, clouds: THREE.Object3D, camera: THREE.Camera): void {
    this.scene.add(clouds);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(null);
  }

  dispose(): void {
    this.target.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}

/** Most communities the ball shows (uniform arrays of the shader); the smallest beyond are left out. */
export const MAX_CAPS = 96;

/**
 * The opaque ball of the sphere layout: it hides whatever lies behind it, and its surface shows one
 * soft coloured cap per community; overlapping caps mix their colours. ``pickMesh`` occludes the nodes
 * behind it in the GPU pick pass.
 */
export class BallLayer {
  readonly mesh: THREE.Mesh;
  readonly pickMesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  /** per cap: direction and angular radius; colour and weight */
  private capDir = Array.from({ length: MAX_CAPS }, () => new THREE.Vector4());
  private capColour = Array.from({ length: MAX_CAPS }, () => new THREE.Vector4());
  private caps: SphereCap[];
  private colours: [number, number, number][];
  private activity: Float32Array;
  private focus: number | null = null;

  constructor(readonly radius: number, caps: SphereCap[], colours: string[], background: string) {
    this.caps = caps.slice(0, MAX_CAPS);
    this.colours = colours.slice(0, MAX_CAPS).map(rgb);
    this.activity = new Float32Array(this.caps.length).fill(1);
    this.writeCaps();
    const geometry = new THREE.SphereGeometry(radius, 96, 64);
    this.material = new THREE.ShaderMaterial({
      vertexShader: ballVertex, fragmentShader: ballFragment,
      uniforms: {
        uCapDir: { value: this.capDir }, uCapColour: { value: this.capColour }, uCount: { value: this.caps.length },
        uBase: { value: new THREE.Vector3(...rgb(background)).multiplyScalar(1.5).addScalar(0.03) },
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1;
    this.pickMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  }

  /** Share of each community's members that are active (0 … 1): inactive caps turn grey. */
  setActivity(activity: Float32Array): void {
    this.caps.forEach((_, k) => (this.activity[k] = activity[k] ?? 1));
    this.writeCaps();
  }

  setFocus(community: number | null): void {
    this.focus = community;
    this.writeCaps();
  }

  /** Grow or shrink the ball with the morph (0 = gone). */
  setScale(k: number): void {
    this.mesh.scale.setScalar(Math.max(1e-3, k));
    this.pickMesh.scale.setScalar(Math.max(1e-3, k));
    this.mesh.visible = this.pickMesh.visible = k > 0.01;
  }

  /** Community whose cap is strongest at a point of the ball (unit direction), if one is strong enough. */
  communityAt(dir: THREE.Vector3): number | null {
    let best: number | null = null;
    let bestW = 0.25;
    this.caps.forEach((c, k) => {
      const angle = Math.acos(Math.min(1, Math.max(-1, dir.x * c.dir[0] + dir.y * c.dir[1] + dir.z * c.dir[2])));
      const w = Math.exp(-1.6 * (angle / c.angle) ** 2);
      if (w > bestW) {
        best = k;
        bestW = w;
      }
    });
    return best;
  }

  /** The uniform arrays are shared with the material: changing the vectors is enough. */
  private writeCaps(): void {
    this.caps.forEach((c, k) => {
      this.capDir[k].set(c.dir[0], c.dir[1], c.dir[2], c.angle);
      const col = this.colours[k] ?? [0.5, 0.5, 0.5];
      const a = this.activity[k];
      const grey = 0.06 + 0.35 * (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]);
      const mix = (x: number) => grey + (x - grey) * a;
      this.capColour[k].set(mix(col[0]), mix(col[1]), mix(col[2]), this.focus === null || this.focus === k ? 1 : 0.12);
    });
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    (this.pickMesh.material as THREE.Material).dispose();
  }
}

export interface ArrowInfo {
  link: SentimentLink;
  from: string;
  to: string;
}

/** Curved arrows between community clouds: green = supportive (mean > 0), red = hostile. */
export class ArrowsLayer {
  readonly group = new THREE.Group();
  private materials: THREE.MeshBasicMaterial[] = [];
  private baseOpacity: number[] = [];

  constructor(communities: CommunityInfo[], links: SentimentLink[], colours: Record<string, string>) {
    const maxN = Math.max(1, ...links.map((l) => l.n));
    // widths relative to the typical cloud, so arrows read the same at any layout scale
    const scale = communities.reduce((s, c) => s + c.radius, 0) / Math.max(1, communities.length) / 60;
    const positive = new THREE.Color(colours.positive ?? '#3ddc84');
    const negative = new THREE.Color(colours.negative ?? '#ff4d4d');
    const up = new THREE.Vector3(0, 1, 0);
    for (const link of links) {
      const a = communities[link.src];
      const b = communities[link.dst];
      if (!a || !b) continue;
      const ca = new THREE.Vector3(...a.centre);
      const cb = new THREE.Vector3(...b.centre);
      const dist = ca.distanceTo(cb);
      if (dist < 1e-6) continue;
      const dir = cb.clone().sub(ca).normalize();
      const start = ca.clone().addScaledVector(dir, Math.min(a.radius * 0.7, dist * 0.3));
      const end = cb.clone().addScaledVector(dir, -Math.min(b.radius * 0.7, dist * 0.3));
      // A→B and B→A bend to opposite sides of the same plane
      const lowFirst = link.src < link.dst;
      const base = lowFirst ? dir.clone() : dir.clone().negate();
      let side = new THREE.Vector3().crossVectors(base, up);
      if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
      side.normalize().multiplyScalar(dist * 0.12 * (lowFirst ? 1 : -1));
      const control = start.clone().add(end).multiplyScalar(0.5).add(side);
      const curve = new THREE.QuadraticBezierCurve3(start, control, end);
      const width = (0.5 + 2.0 * Math.min(1, Math.abs(link.mean) / 5)) * scale;
      const opacity = 0.25 + 0.5 * Math.log1p(link.n) / Math.log1p(maxN);
      const material = new THREE.MeshBasicMaterial({
        color: link.mean >= 0 ? positive : negative, transparent: true, opacity: 0, depthWrite: false,
      });
      const info: ArrowInfo = { link, from: a.label, to: b.label };
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, width, 8, false), material);
      tube.userData = info;
      const tangent = curve.getTangent(1);
      const head = new THREE.Mesh(new THREE.ConeGeometry(width * 3, width * 8, 12), material);
      head.position.copy(end);
      head.quaternion.setFromUnitVectors(up, tangent);
      head.userData = info;
      this.group.add(tube, head);
      this.materials.push(material);
      this.baseOpacity.push(opacity);
    }
    this.group.renderOrder = 3;
  }

  setOpacity(factor: number): void {
    this.group.visible = factor > 0.01;
    this.materials.forEach((m, i) => (m.opacity = this.baseOpacity[i] * factor));
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}
