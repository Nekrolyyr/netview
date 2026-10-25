/** The scene layers: nodes (points), edges (line segments), community clouds (splats), sentiment arrows. */

import * as THREE from 'three';

import type { Graph } from '../data/graph';
import { FLAG, type CommunityInfo, type SentimentLink } from '../data/types';
import {
  cloudFragment, cloudVertex, compositeFragment, compositeVertex, edgeFragment, edgeVertex, nodeFragment, nodeVertex,
  pickFragment, pickVertex,
} from './shaders';

export function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color();
  c.setStyle(hex, THREE.NoColorSpace);
  return [c.r, c.g, c.b];
}

/** Node colour: whitelist (bright red) > influencer (pink) > everyone else (white). */
export function nodeColours(graph: Graph): Float32Array {
  const { colours } = graph.data.meta;
  const red = rgb(colours.whitelist ?? '#ff2a2a');
  const pink = rgb(colours.influencer ?? '#ff5fc8');
  const white = rgb(colours.other ?? '#f2f0f5');
  const flags = graph.arrays.flags;
  const out = new Float32Array(graph.n * 3);
  for (let i = 0; i < graph.n; i++) {
    const c = flags[i] & FLAG.whitelist ? red : flags[i] & FLAG.influencer ? pink : white;
    out.set(c, 3 * i);
  }
  return out;
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
    g.setAttribute('position', new THREE.BufferAttribute(graph.arrays.position, 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(graph.arrays.radius), 1));
    this.colours = nodeColours(graph);
    g.setAttribute('aColour', new THREE.BufferAttribute(this.colours, 3));
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

export class EdgesLayer {
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly lines: THREE.LineSegments;

  constructor(readonly graph: Graph, nodeColour: Float32Array) {
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
      uniforms: { uTime: { value: 0 }, uTypeMask: { value: 0xff }, uOpacity: { value: 1 }, uFocus: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
  }

  /** Edge activation = the later of its endpoints' effective times. */
  setTimes(tEff: Float32Array): void {
    const { edge_src, edge_dst } = this.graph.arrays;
    const a = this.geometry.getAttribute('aTeff') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let e = 0; e < edge_src.length; e++) {
      arr[2 * e] = arr[2 * e + 1] = Math.max(tEff[edge_src[e]], tEff[edge_dst[e]]);
    }
    a.needsUpdate = true;
  }

  setHighlight(edges: Set<number>): void {
    const a = this.geometry.getAttribute('aHighlight') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    arr.fill(0);
    for (const e of edges) arr[2 * e] = arr[2 * e + 1] = 1;
    a.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
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

  /** Brighten the selected community, dim the others. */
  setFocus(selected: number | null): void {
    const a = this.geometry.getAttribute('iColour') as THREE.InstancedBufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = 0; k < this.community.length; k++) {
      const f = selected === null || this.community[k] === selected ? 1 : 0.3;
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
