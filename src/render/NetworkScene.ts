/**
 * The 3D viewport: renderer, camera and orbit controls, layers, GPU picking, labels and transitions.
 * Svelte components drive it through the setters; it reports hover and click back through callbacks.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Graph } from '../data/graph';
import { FLAG, type ReachResult } from '../data/types';
import { absorbedActive, communityActivity, effectiveTimes, radiusAt } from '../filters/time';
import { isLabelled, MODE_LAYOUT, MODE_STYLE, nodeVisibility, type ViewMode } from '../filters/visibility';
import { compact } from '../ui/format';
import { ArrowsLayer, BallLayer, CloudComposite, CloudsLayer, EdgesLayer, NodesLayer, type ArrowInfo } from './layers';
import { placeLabels, type LabelCandidate } from './labelPlacement';
import {
  computeLayout, SPHERE_LINK_LIFT, SPHERE_NODE_LIFT, type Layout, type LayoutInput, type LayoutKind,
} from './layouts';

export type HoverInfo =
  | { kind: 'node'; node: number; x: number; y: number }
  | { kind: 'community'; community: number; x: number; y: number }
  | { kind: 'arrow'; arrow: ArrowInfo; x: number; y: number };

export interface SceneSettings {
  nodeScale: number;
  cloudOpacity: number;
  edgeOpacity: number;
  maxLabels: number;
  autoRotate: boolean;
  influencerEdges: boolean;
  /** names of the communities at their clouds */
  communityLabels: boolean;
  /** zoomed out: ordinary nodes recede and links fade, so the clouds and labels carry the overview */
  lod: boolean;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  nodeScale: 0.5, cloudOpacity: 2, edgeOpacity: 0.1, maxLabels: 0, autoRotate: false, influencerEdges: false,
  communityLabels: true, lod: true,
};

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  apply: (v: number) => void;
  done?: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const PICK_SCALE = 0.5;
const MORPH_MS = 900;
/** camera direction of the 3D layout and of the flat (ordered) layouts */
const VIEW_3D = new THREE.Vector3(0.35, 0.3, 1).normalize();
const VIEW_FLAT = new THREE.Vector3(0, 0, 1);

export class NetworkScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private pickScene = new THREE.Scene();
  private pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private composite = new CloudComposite();
  private pickBuffer = new Uint8Array(4);
  private pickDirty = true;
  private lastPick = 0;
  private labelCanvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private labelAlpha = new Map<number, number>();
  private labelWidth = new Map<number, number>();
  private raycaster = new THREE.Raycaster();

  private graph: Graph | null = null;
  private nodes: NodesLayer | null = null;
  private edges: EdgesLayer | null = null;
  private clouds: CloudsLayer | null = null;
  private arrows: ArrowsLayer | null = null;
  private ball: BallLayer | null = null;
  private centre = new THREE.Vector3();
  /** radius around the centre that holds 95 % of the nodes (camera fit; a few outliers would dominate the max) */
  private fitRadius = 1;

  /** current node positions and community centres (the morph between two layouts writes them) */
  private pos = new Float32Array(0);
  private centres: [number, number, number][] = [];
  private squash = 1;
  private layoutKind: LayoutKind = 'force';
  private layouts = new Map<LayoutKind, Layout>();
  private guideAlpha = 0;
  private morphing = false;

  private mode: ViewMode = 'network';
  private time = 0;
  private reach: ReachResult | null = null;
  private tEff = new Float32Array(0);
  private visTo = new Float32Array(0);
  private absorbed = new Float32Array(0);
  private selected: number | null = null;
  private selectedCommunity: number | null = null;
  private settings: SceneSettings = { ...DEFAULT_SCENE_SETTINGS };
  private styles = { edges: 1, clouds: 0.18, arrows: 0 };
  private tweens: Tween[] = [];
  private sizeTimer = 0;
  private activityDirty = true;
  private lastActivity = 0;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private width = 1;
  private height = 1;
  private pointer: { x: number; y: number; down: number; downX: number; downY: number } =
    { x: -1, y: -1, down: 0, downX: 0, downY: 0 };

  onHover: (info: HoverInfo | null) => void = () => {};
  onClick: (info: HoverInfo | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.className = 'viewport-labels';
    container.appendChild(this.labelCanvas);
    this.labelCtx = this.labelCanvas.getContext('2d')!;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('change', () => (this.pickDirty = true));

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.handleMove);
    el.addEventListener('pointerdown', this.handleDown);
    el.addEventListener('pointerup', this.handleUp);
    el.addEventListener('pointerleave', this.handleLeave);
    el.addEventListener('dblclick', this.handleDouble);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ data
  load(graph: Graph): void {
    this.unload();
    this.graph = graph;
    const { meta, arrays } = graph.data;
    this.nodes = new NodesLayer(graph);
    this.edges = new EdgesLayer(graph, this.nodes.colours);
    this.clouds = new CloudsLayer(graph.data.communities);
    this.arrows = new ArrowsLayer(graph.data.communities, graph.data.sentiment, meta.colours);
    this.scene.add(this.composite.quad, this.edges.lines, this.edges.arcs, this.nodes.points, this.arrows.group);
    this.pickScene.add(this.nodes.pickPoints);

    this.layouts.clear();
    this.layoutKind = MODE_LAYOUT[this.mode];
    const layout = this.layout(this.layoutKind);
    this.applyLayout(layout);
    if (layout.sphere) {
      this.ensureBall(layout).setScale(1);
      this.edges.setArcMode(true);
    }
    this.guideAlpha = 1;
    this.camera.near = Math.max(0.05, meta.extent / 2000);
    this.camera.far = meta.extent * 40;
    this.camera.updateProjectionMatrix();
    this.tEff = new Float32Array(graph.n);
    this.visTo = nodeVisibility(this.mode, arrays.flags);
    this.nodes.set('aVisFrom', this.visTo);
    this.nodes.set('aVisTo', this.visTo);
    this.time = meta.t_max;
    this.reach = null;
    this.selected = null;
    this.selectedCommunity = null;
    this.labelAlpha.clear();
    this.labelWidth.clear();
    this.updateTimes();
    this.updateSizes();
    this.applyStyle(MODE_STYLE[this.mode], false);
    this.resetView(false);
  }

  // ------------------------------------------------------------------ layouts
  private layoutInput(graph: Graph): LayoutInput {
    const { arrays, communities } = graph.data;
    return {
      n: graph.n, position: arrays.position, community: arrays.community, flags: arrays.flags,
      adjOffsets: arrays.adj_offsets, adjNodes: arrays.adj_nodes,
      communities: communities.map((c) => ({
        centre: c.centre, radius: c.radius, size: c.sizeWithAbsorbed, meanSentiment: c.meanSentiment, isSource: c.isSource,
      })),
    };
  }

  /** Computed once per bundle and kind. */
  private layout(kind: LayoutKind): Layout {
    let layout = this.layouts.get(kind);
    if (!layout) {
      layout = computeLayout(kind, this.layoutInput(this.graph!));
      this.layouts.set(kind, layout);
    }
    return layout;
  }

  /** Write positions and centres to the layers. */
  private applyPositions(pos: Float32Array, centres: [number, number, number][], squash: number): void {
    this.pos = pos;
    this.centres = centres;
    this.squash = squash;
    if (this.nodes) this.nodes.set('position', pos);
    this.edges?.setPositions(pos);
    this.clouds?.place(centres, squash);
    this.pickDirty = true;
  }

  private applyLayout(layout: Layout): void {
    this.applyPositions(new Float32Array(layout.position), layout.centres.map((c) => [...c]), layout.squash);
    this.fit(layout);
  }

  /** The ball and the link arcs of the sphere layout, made on first use. */
  private ensureBall(layout: Layout): BallLayer {
    if (!this.ball && this.graph && layout.sphere) {
      const { communities, meta } = this.graph.data;
      this.ball = new BallLayer(layout.sphere.radius, layout.sphere.caps, communities.map((c) => c.colour),
        meta.colours.background ?? '#14101c');
      this.ball.setScale(0);
      this.scene.add(this.ball.mesh);
      this.pickScene.add(this.ball.pickMesh);
      this.edges?.buildArcs(layout.position, layout.sphere.radius * SPHERE_LINK_LIFT);
      this.activityDirty = true;
    }
    return this.ball!;
  }

  /** Centre and fit radius of a layout; the flat ones also keep every community cloud in view. */
  private fit(layout: Layout): void {
    if (layout.sphere) {
      this.centre.set(0, 0, 0);
      this.fitRadius = layout.sphere.radius * SPHERE_NODE_LIFT * 1.08;
      return;
    }
    const p = layout.position;
    const n = p.length / 3;
    this.centre.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.centre.x += p[3 * i] / n;
      this.centre.y += p[3 * i + 1] / n;
      this.centre.z += p[3 * i + 2] / n;
    }
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      dist[i] = Math.hypot(p[3 * i] - this.centre.x, p[3 * i + 1] - this.centre.y, p[3 * i + 2] - this.centre.z);
    }
    dist.sort();
    this.fitRadius = Math.max(1, dist[Math.floor(0.95 * (n - 1))] ?? this.graph?.data.meta.extent ?? 1);
    if (layout.kind !== 'force' && this.graph) {
      for (const c of this.graph.data.communities) {
        const [x, y, z] = layout.centres[c.id];
        const r = Math.hypot(x - this.centre.x, y - this.centre.y, z - this.centre.z) + c.radius;
        this.fitRadius = Math.max(this.fitRadius, r);
      }
    }
  }

  /** Morph from the current positions to another layout and fit the camera to it. */
  private morphTo(kind: LayoutKind): void {
    const target = this.layout(kind);
    this.layoutKind = kind;
    const fromPos = new Float32Array(this.pos);
    const fromCentres = this.centres.map((c) => [...c]);
    const fromSquash = this.squash;
    const pos = new Float32Array(fromPos.length);
    this.fit(target);
    this.morphing = true;
    this.guideAlpha = 0;
    // the ball grows while the nodes fly onto it, and shrinks away when they leave; arcs only once they are there
    const ball = target.sphere ? this.ensureBall(target) : this.ball;
    const fromScale = ball?.mesh.visible ? ball.mesh.scale.x : 0;
    const toScale = target.sphere ? 1 : 0;
    this.edges?.setArcMode(false);
    this.tween(0, 1, MORPH_MS, (v) => {
      const k = ease(v);
      for (let i = 0; i < pos.length; i++) pos[i] = fromPos[i] + (target.position[i] - fromPos[i]) * k;
      const centres = target.centres.map((c, j) =>
        c.map((x, d) => fromCentres[j][d] + (x - fromCentres[j][d]) * k) as [number, number, number]);
      this.applyPositions(pos, centres, fromSquash + (target.squash - fromSquash) * k);
      ball?.setScale(fromScale + (toScale - fromScale) * k);
    }, () => {
      this.morphing = false;
      this.labelAlpha.clear();
      if (target.sphere && this.layoutKind === 'sphere') this.edges?.setArcMode(true);
    });
    this.resetView(true, MORPH_MS);
  }

  private unload(): void {
    for (const layer of [this.nodes, this.edges, this.clouds, this.arrows, this.ball]) layer?.dispose();
    this.scene.clear();
    this.pickScene.clear();
    this.composite.scene.clear();
    this.nodes = this.edges = this.clouds = this.arrows = this.ball = null;
    this.graph = null;
  }

  // ------------------------------------------------------------------ setters
  setMode(mode: ViewMode): void {
    if (mode === this.mode || !this.nodes || !this.graph) {
      this.mode = mode;
      return;
    }
    this.mode = mode;
    const from = this.currentVisibility();
    this.visTo = nodeVisibility(mode, this.graph.arrays.flags);
    this.nodes.set('aVisFrom', from);
    this.nodes.set('aVisTo', this.visTo);
    const mix = this.nodes.material.uniforms.uMix;
    mix.value = 0;
    this.tween(0, 1, 320, (v) => {
      mix.value = v;
      this.pickDirty = true;
    });
    this.applyStyle(MODE_STYLE[mode], true);
    this.labelAlpha.clear();
    if (MODE_LAYOUT[mode] !== this.layoutKind) this.morphTo(MODE_LAYOUT[mode]);
  }

  setTime(t: number): void {
    if (t === this.time) return;
    this.time = t;
    this.setUniform('uTime', t);
    this.activityDirty = true;
    window.clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => this.updateSizes(), 120);
  }

  setReach(reach: ReachResult | null): void {
    this.reach = reach;
    this.updateTimes();
  }

  setEdgeTypes(mask: number): void {
    if (this.edges) this.edges.material.uniforms.uTypeMask.value = mask;
  }

  setSettings(settings: SceneSettings): void {
    this.settings = { ...DEFAULT_SCENE_SETTINGS, ...settings };
    this.controls.autoRotate = settings.autoRotate;
    this.controls.autoRotateSpeed = 0.6;
    if (this.nodes) this.nodes.material.uniforms.uSizeScale.value = settings.nodeScale;
    this.applyStyle(MODE_STYLE[this.mode], false);
    this.pickDirty = true;
  }

  select(node: number | null): void {
    this.selected = node;
    this.updateHighlight();
  }

  /** Focus a community: its members and inner links stay, everything else fades far back. */
  selectCommunity(community: number | null): void {
    this.selectedCommunity = community;
    this.clouds?.setFocus(community);
    this.ball?.setFocus(community);
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (!this.nodes || !this.edges || !this.graph) return;
    const hl = new Float32Array(this.graph.n);
    const edges = new Set<number>();
    const node = this.selected;
    const community = this.selectedCommunity;
    if (node !== null) {
      for (const { node: j, edge } of this.graph.neighbours(node)) {
        hl[j] = 1;
        edges.add(edge);
      }
      hl[node] = 2;
    } else if (community !== null) {
      const { community: of, edge_src, edge_dst } = this.graph.arrays;
      for (const i of this.graph.members[community] ?? []) hl[i] = 1;
      for (let e = 0; e < edge_src.length; e++) {
        if (of[edge_src[e]] === community && of[edge_dst[e]] === community) edges.add(e);
      }
    }
    this.nodes.set('aHighlight', hl);
    this.edges.setHighlight(edges);
    const focus = node === null && community === null ? 0 : 1;
    this.nodes.material.uniforms.uFocus.value = focus;
    this.nodes.material.uniforms.uDim.value = node === null ? 0.1 : 0.22;
    this.edges.material.uniforms.uFocus.value = focus;
  }

  /** Fly the camera to a node (or a point with a viewing distance). */
  flyTo(node: number): void {
    if (!this.graph) return;
    const target = new THREE.Vector3(this.pos[3 * node], this.pos[3 * node + 1], this.pos[3 * node + 2]);
    const r = this.graph.arrays.radius[node];
    this.flyToPoint(target, Math.max(r * 25, this.fitRadius * 0.12), this.surfaceNormal(target));
  }

  flyToCommunity(community: number): void {
    const c = this.graph?.data.communities[community];
    if (!c) return;
    const target = new THREE.Vector3(...this.centres[community]);
    this.flyToPoint(target, c.radius * 3.2, this.surfaceNormal(target));
  }

  /** On the ball the camera looks straight down onto the surface; elsewhere it keeps its direction. */
  private surfaceNormal(point: THREE.Vector3): THREE.Vector3 | undefined {
    return this.layoutKind === 'sphere' && point.lengthSq() > 0 ? point.clone().normalize() : undefined;
  }

  /** Camera distance at which the whole layout fits the view. */
  private fitDistance(): number {
    return this.fitRadius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
  }

  resetView(animate = true, duration = 700): void {
    if (!this.graph) return;
    const distance = this.fitDistance();
    const dir = this.layoutKind === 'force' || this.layoutKind === 'sphere' ? VIEW_3D : VIEW_FLAT;
    if (!animate) {
      this.controls.target.copy(this.centre);
      this.camera.position.copy(this.centre).addScaledVector(dir, distance);
      this.controls.update();
      return;
    }
    this.flyToPoint(this.centre.clone(), distance, dir, duration);
  }

  private flyToPoint(target: THREE.Vector3, distance: number, direction?: THREE.Vector3, duration = 700): void {
    const startTarget = this.controls.target.clone();
    const startPos = this.camera.position.clone();
    const dir = direction ?? startPos.clone().sub(startTarget).normalize();
    const endPos = target.clone().addScaledVector(dir, distance);
    this.tween(0, 1, duration, (v) => {
      const k = ease(v);
      this.controls.target.lerpVectors(startTarget, target, k);
      this.camera.position.lerpVectors(startPos, endPos, k);
      this.pickDirty = true;
    });
  }

  // ------------------------------------------------------------------ internals
  private setUniform(name: string, value: number): void {
    if (this.nodes) this.nodes.material.uniforms[name].value = value;
    if (this.edges && name in this.edges.material.uniforms) this.edges.material.uniforms[name].value = value;
  }

  private currentVisibility(): Float32Array {
    if (!this.nodes) return this.visTo;
    const from = this.nodes.attr('aVisFrom').array as Float32Array;
    const to = this.nodes.attr('aVisTo').array as Float32Array;
    const m = this.nodes.material.uniforms.uMix.value as number;
    return from.map((f, i) => f + (to[i] - f) * m);
  }

  private applyStyle(target: { edges: number; clouds: number; arrows: number }, animate: boolean): void {
    const s = this.settings;
    const edgeTarget = (this.mode === 'influencer' && s.influencerEdges ? 1 : target.edges) * s.edgeOpacity;
    const goal = { edges: edgeTarget, clouds: target.clouds * s.cloudOpacity, arrows: target.arrows };
    const set = (v: typeof goal) => {
      this.styles = v;
      if (this.edges) {
        this.edges.material.uniforms.uOpacity.value = v.edges;
        this.edges.setVisible(v.edges > 0.005);
      }
      if (this.clouds) this.clouds.material.uniforms.uOpacity.value = v.clouds;
      this.arrows?.setOpacity(v.arrows);
    };
    if (!animate) {
      set(goal);
      return;
    }
    const start = { ...this.styles };
    this.tween(0, 1, 320, (k) => set({
      edges: start.edges + (goal.edges - start.edges) * k,
      clouds: start.clouds + (goal.clouds - start.clouds) * k,
      arrows: start.arrows + (goal.arrows - start.arrows) * k,
    }));
  }

  private updateTimes(): void {
    if (!this.graph || !this.nodes || !this.edges) return;
    const { meta, arrays } = this.graph.data;
    this.tEff = effectiveTimes(arrays.t_act, meta.t_max, this.reach, this.tEff);
    this.nodes.set('aTeff', this.tEff);
    this.edges.setTimes(this.tEff);
    this.setUniform('uTime', this.time);
    this.activityDirty = true;
  }

  private updateSizes(): void {
    if (!this.graph || !this.nodes) return;
    const { meta, arrays } = this.graph.data;
    this.absorbed = absorbedActive(arrays.absorbed_offsets, arrays.absorbed_t, this.time, meta.t_max, this.absorbed);
    this.nodes.set('aRadius', radiusAt(meta.size_base, meta.size_k, this.absorbed));
    this.pickDirty = true;
    this.activityDirty = true;
  }

  private updateActivity(): void {
    if (!this.graph || !this.clouds) return;
    const { arrays, communities } = this.graph.data;
    const sizes = communities.map((c) => c.sizeWithAbsorbed);
    const absorbed = this.absorbed.length ? this.absorbed : new Float32Array(this.graph.n);
    const activity = communityActivity(arrays.community, this.tEff, this.time, absorbed, arrays.absorbed_count, sizes);
    this.clouds.setActivity(activity);
    this.ball?.setActivity(activity);
  }

  private tween(from: number, to: number, duration: number, apply: (v: number) => void, done?: () => void): void {
    this.tweens.push({ from, to, start: performance.now(), duration, apply, done });
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const ratio = this.renderer.getPixelRatio();
    this.labelCanvas.width = Math.round(w * ratio);
    this.labelCanvas.height = Math.round(h * ratio);
    this.labelCanvas.style.width = `${w}px`;
    this.labelCanvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composite.setSize(w * ratio, h * ratio);
    this.pickTarget.setSize(Math.max(1, Math.round(w * PICK_SCALE)), Math.max(1, Math.round(h * PICK_SCALE)));
    this.pickBuffer = new Uint8Array(this.pickTarget.width * this.pickTarget.height * 4);
    this.pickDirty = true;
  }

  /** Pixels per world unit at distance 1 (for point sizes). */
  private projScale(heightPx: number): number {
    return heightPx / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  private renderPick(): void {
    if (!this.nodes) return;
    const now = performance.now();
    if (!this.pickDirty || now - this.lastPick < 90) return;
    this.lastPick = now;
    this.pickDirty = false;
    this.nodes.pickMaterial.uniforms.uProjScale.value = this.projScale(this.pickTarget.height);
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.pickScene, this.camera);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, this.pickTarget.width, this.pickTarget.height,
      this.pickBuffer);
    this.renderer.setRenderTarget(null);
  }

  /** Node under a CSS pixel (from the last pick buffer), or -1. */
  private nodeAt(x: number, y: number): number {
    const w = this.pickTarget.width;
    const h = this.pickTarget.height;
    const px = Math.floor(x * PICK_SCALE);
    const py = h - 1 - Math.floor(y * PICK_SCALE);
    if (px < 0 || py < 0 || px >= w || py >= h) return -1;
    const k = 4 * (py * w + px);
    const id = this.pickBuffer[k] + this.pickBuffer[k + 1] * 256 + this.pickBuffer[k + 2] * 65536;
    return id - 1;
  }

  /** What is under a CSS pixel. ``fresh`` re-renders the id buffer first (clicks); hover uses the cached one. */
  private hit(x: number, y: number, fresh = false): HoverInfo | null {
    if (!this.graph) return null;
    if (fresh) {
      this.pickDirty = true;
      this.lastPick = 0;
      this.renderPick();
    }
    const node = this.nodeAt(x, y);
    if (node >= 0) return { kind: 'node', node, x, y };
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    if (this.arrows && this.styles.arrows > 0.5) {
      this.raycaster.setFromCamera(ndc, this.camera);
      const [first] = this.raycaster.intersectObjects(this.arrows.group.children, false);
      if (first) return { kind: 'arrow', arrow: first.object.userData as ArrowInfo, x, y };
    }
    if (this.layoutKind === 'sphere' && this.ball?.mesh.visible) {
      // the cap under the cursor, where the ray meets the front of the ball
      this.raycaster.setFromCamera(ndc, this.camera);
      const [first] = this.raycaster.intersectObject(this.ball.mesh, false);
      const community = first ? this.ball.communityAt(first.point.clone().normalize()) : null;
      return community === null ? null : { kind: 'community', community, x, y };
    }
    if (this.styles.clouds > 0.5) {
      // community whose cloud centre is closest on screen, if the cursor is inside its projected radius
      let best = -1;
      let bestScore = Infinity;
      for (const c of this.graph.data.communities) {
        const centre = new THREE.Vector3(...this.centres[c.id]);
        const p = centre.clone().project(this.camera);
        if (p.z > 1) continue;
        const sx = (p.x + 1) / 2 * this.width;
        const sy = (1 - p.y) / 2 * this.height;
        const dist = centre.distanceTo(this.camera.position);
        const rPx = c.radius * this.projScale(this.height) / dist;
        const d = Math.hypot(sx - x, sy - y);
        if (d < rPx && d / rPx < bestScore) {
          best = c.id;
          bestScore = d / rPx;
        }
      }
      if (best >= 0) return { kind: 'community', community: best, x, y };
    }
    return null;
  }

  private handleMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
    if (this.pointer.down) return;
    this.hoverPending = true;
  };

  private hoverPending = false;

  private handleDown = (e: PointerEvent) => {
    this.pointer.down = e.button + 1;
    this.pointer.downX = e.clientX;
    this.pointer.downY = e.clientY;
  };

  private handleUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY);
    const button = this.pointer.down;
    this.pointer.down = 0;
    if (button === 1 && moved < 5) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.onClick(this.hit(e.clientX - rect.left, e.clientY - rect.top, true));
    }
  };

  private handleLeave = () => {
    this.pointer.x = this.pointer.y = -1;
    this.onHover(null);
  };

  private handleDouble = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const info = this.hit(e.clientX - rect.left, e.clientY - rect.top, true);
    if (info?.kind === 'node') this.flyTo(info.node);
    else if (info?.kind === 'community') this.flyToCommunity(info.community);
  };

  // ------------------------------------------------------------------ labels
  private drawLabels(): void {
    const ctx = this.labelCtx;
    const ratio = this.renderer.getPixelRatio();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const graph = this.graph;
    if (!graph || !this.nodes) return;
    this.drawGuides();
    const communityBoxes = this.drawCommunityLabels();
    if (this.settings.maxLabels <= 0 || this.morphing) return;
    const { flags, label_priority } = graph.arrays;
    const position = this.pos;
    const radius = this.nodes.attr('aRadius').array as Float32Array;
    const vis = this.visTo;
    const cam = this.camera.position;
    const toCamera = cam.clone().sub(this.centre);
    const projScale = this.projScale(this.height) * this.settings.nodeScale;
    ctx.font = '600 12px Inter, "Segoe UI", system-ui, sans-serif';
    const candidates: LabelCandidate[] = [...communityBoxes];
    const v = new THREE.Vector3();
    for (let i = 0; i < graph.n; i++) {
      if (!isLabelled(flags[i]) || vis[i] < 0.5) continue;
      v.set(position[3 * i], position[3 * i + 1], position[3 * i + 2]);
      // facing the user: on the camera's side of the node cloud (the flat layouts face it as a whole) ...
      if ((this.layoutKind === 'force' || this.layoutKind === 'sphere') && (v.x - this.centre.x) * toCamera.x + (v.y - this.centre.y) * toCamera.y
        + (v.z - this.centre.z) * toCamera.z < 0 && this.selected !== i) continue;
      const dist = v.distanceTo(cam);
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x + 1) / 2 * this.width;
      const sy = (1 - v.y) / 2 * this.height;
      // ... and not hidden behind another node (GPU id buffer at the node's pixel)
      const under = this.nodeAt(sx, sy);
      if (under !== i && under !== -1 && this.selected !== i) continue;
      const name = graph.name(i);
      let width = this.labelWidth.get(i);
      if (width === undefined) {
        width = ctx.measureText(name).width;
        this.labelWidth.set(i, width);
      }
      const rPx = radius[i] * projScale / dist;
      const bonus = this.selected === i ? 100 : flags[i] & FLAG.whitelist ? 2 : 0;
      candidates.push({
        id: i, x: sx, y: sy - rPx - 3, width, height: 14,
        priority: Math.log10(label_priority[i] + 10) + bonus - dist / (this.fitRadius * 8),
      });
    }
    // community labels (negative ids, already drawn) only block space
    const placed = placeLabels(candidates, this.width, this.height, this.settings.maxLabels + communityBoxes.length);
    const keep = new Set<number>();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    for (const p of placed) {
      if (p.id < 0) continue;
      keep.add(p.id);
      const alpha = Math.min(1, (this.labelAlpha.get(p.id) ?? 0) + 0.12);
      this.labelAlpha.set(p.id, alpha);
      const isSource = (flags[p.id] & FLAG.whitelist) !== 0;
      ctx.globalAlpha = alpha * (this.selected !== null && this.selected !== p.id ? 0.55 : 1);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(14, 10, 20, 0.85)';
      const name = graph.name(p.id);
      ctx.strokeText(name, p.x, p.y);
      ctx.fillStyle = isSource ? '#ff8a8a' : '#ffb8e8';
      ctx.fillText(name, p.x, p.y);
    }
    for (const id of [...this.labelAlpha.keys()]) if (!keep.has(id)) this.labelAlpha.delete(id);
    ctx.globalAlpha = 1;
  }

  /** CSS pixel position of a world point, or null behind the camera. */
  private toScreen(x: number, y: number, z: number): [number, number] | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [(v.x + 1) / 2 * this.width, (1 - v.y) / 2 * this.height];
  }

  /**
   * Name and size of every community at its cloud, larger communities first; a dot in the community
   * colour carries the identity, the text stays in text colours. Returns the boxes for the node labels.
   */
  private drawCommunityLabels(): LabelCandidate[] {
    const graph = this.graph;
    if (!graph || !this.settings.communityLabels) return [];
    // labels go with the clouds, or with the caps of the ball
    if (this.styles.clouds < 0.05 && !(this.layoutKind === 'sphere' && this.ball?.mesh.visible)) return [];
    const ctx = this.labelCtx;
    const { communities } = graph.data;
    const maxSize = Math.max(1, ...communities.map((c) => c.sizeWithAbsorbed));
    const candidates: (LabelCandidate & { font: number; text: string; count: string })[] = [];
    for (const c of communities) {
      const at = this.centres[c.id];
      // the back of the ball hides its caps
      if (at && this.layoutKind === 'sphere' && at[0] * (this.camera.position.x - at[0])
        + at[1] * (this.camera.position.y - at[1]) + at[2] * (this.camera.position.z - at[2]) <= 0) continue;
      const p = at && this.toScreen(at[0], at[1], at[2]);
      if (!p) continue;
      const font = Math.round(11 + 5 * Math.sqrt(c.sizeWithAbsorbed / maxSize));
      const text = c.label.length > 28 ? `${c.label.slice(0, 27)}…` : c.label;
      const count = compact(c.sizeWithAbsorbed);
      ctx.font = `600 ${font}px Inter, "Segoe UI", system-ui, sans-serif`;
      const width = ctx.measureText(text).width + 14;
      ctx.font = `500 ${font - 2}px Inter, "Segoe UI", system-ui, sans-serif`;
      const countWidth = ctx.measureText(count).width;
      candidates.push({
        id: -1 - c.id, x: p[0], y: p[1] + font * 0.5, width: Math.max(width, countWidth), height: 2.1 * font,
        priority: 1000 + c.sizeWithAbsorbed, font, text, count,
      });
    }
    const placed = placeLabels(candidates, this.width, this.height, candidates.length);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const p of placed) {
      const c = candidates.find((x) => x.id === p.id)!;
      const id = -1 - p.id;
      const focus = this.selectedCommunity;
      ctx.globalAlpha = focus === null || focus === id ? 1 : 0.3;
      const nameY = p.y - c.font * 1.05;
      ctx.font = `600 ${c.font}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(14, 10, 20, 0.85)';
      ctx.strokeText(c.text, p.x + 7, nameY);
      ctx.fillStyle = '#f2eef8';
      ctx.fillText(c.text, p.x + 7, nameY);
      const textWidth = ctx.measureText(c.text).width;
      ctx.beginPath();
      ctx.arc(p.x + 7 - textWidth / 2 - 8, nameY - c.font * 0.38, c.font * 0.3, 0, 2 * Math.PI);
      ctx.fillStyle = graph.data.communities[id].colour;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = `500 ${c.font - 2}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeText(c.count, p.x, p.y);
      ctx.fillStyle = '#b7aec6';
      ctx.fillText(c.count, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    return placed;
  }

  /** Axis, rings and captions of the ordered layouts; they fade in once a morph has ended. */
  private drawGuides(): void {
    const guides = this.layouts.get(this.layoutKind)?.guides;
    if (!guides?.length) return;
    if (!this.morphing) this.guideAlpha = Math.min(1, this.guideAlpha + 0.06);
    if (this.guideAlpha <= 0) return;
    const ctx = this.labelCtx;
    ctx.globalAlpha = this.guideAlpha;
    ctx.strokeStyle = 'rgba(190, 180, 210, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of guides) {
      if (g.kind !== 'line') continue;
      const a = this.toScreen(...g.a);
      const b = this.toScreen(...g.b);
      if (!a || !b) continue;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.textBaseline = 'top';
    for (const g of guides) {
      if (g.kind !== 'text') continue;
      const p = this.toScreen(...g.at);
      if (!p) continue;
      ctx.font = `${g.strong ? 600 : 500} 12px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = g.align;
      ctx.fillStyle = g.strong ? '#d9d2e6' : '#a198b2';
      ctx.fillText(g.text, p[0], p[1]);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.tweens = this.tweens.filter((t) => {
      const k = Math.min(1, (now - t.start) / t.duration);
      t.apply(t.from + (t.to - t.from) * k);
      if (k >= 1) t.done?.();
      return k < 1;
    });
    this.controls.update();
    if (this.nodes) this.nodes.material.uniforms.uProjScale.value = this.projScale(this.height);
    if (this.nodes && this.edges) {
      // level of detail: full at half the overview distance, faded at the overview distance and beyond
      const ratio = this.camera.position.distanceTo(this.controls.target) / this.fitDistance();
      const lod = this.settings.lod ? smoothstep(0.95, 0.5, ratio) : 1;
      this.nodes.material.uniforms.uLod.value = lod;
      // on the ball the arcs are the point of the view: they do not fade
      this.edges.material.uniforms.uLod.value = this.layoutKind === 'sphere' ? 1 : lod;
    }
    if (this.activityDirty && now - this.lastActivity > 50) {
      this.activityDirty = false;
      this.lastActivity = now;
      this.updateActivity();
    }
    this.renderPick();
    if (this.hoverPending && this.pointer.x >= 0) {
      this.hoverPending = false;
      const node = this.nodeAt(this.pointer.x, this.pointer.y);
      if (node >= 0) this.onHover({ kind: 'node', node, x: this.pointer.x, y: this.pointer.y });
      else this.onHover(this.styles.clouds > 0.5 || this.styles.arrows > 0.5 || this.layoutKind === 'sphere'
        ? this.hit(this.pointer.x, this.pointer.y) : null);
    }
    if (this.clouds && this.styles.clouds > 0.003) this.composite.render(this.renderer, this.clouds.mesh, this.camera);
    this.composite.quad.visible = !!this.clouds && this.styles.clouds > 0.003;
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.unload();
    this.controls.dispose();
    this.pickTarget.dispose();
    this.composite.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelCanvas.remove();
  }
}
