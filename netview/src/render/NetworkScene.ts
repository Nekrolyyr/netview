/**
 * The 3D viewport: renderer, camera and orbit controls, layers, GPU picking, labels and transitions.
 * Svelte components drive it through the setters; it reports hover and click back through callbacks.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Graph } from '../data/graph';
import { FLAG, type ReachResult } from '../data/types';
import { absorbedActive, communityActivity, effectiveTimes, radiusAt } from '../filters/time';
import { isLabelled, MODE_STYLE, nodeVisibility, type ViewMode } from '../filters/visibility';
import { ArrowsLayer, CloudComposite, CloudsLayer, EdgesLayer, NodesLayer, type ArrowInfo } from './layers';
import { placeLabels, type LabelCandidate } from './labelPlacement';

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
}

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  apply: (v: number) => void;
  done?: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const PICK_SCALE = 0.5;

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
  private centre = new THREE.Vector3();
  /** radius around the centre that holds 95 % of the nodes (camera fit; a few outliers would dominate the max) */
  private fitRadius = 1;

  private mode: ViewMode = 'network';
  private time = 0;
  private reach: ReachResult | null = null;
  private tEff = new Float32Array(0);
  private visTo = new Float32Array(0);
  private absorbed = new Float32Array(0);
  private selected: number | null = null;
  private settings: SceneSettings = {
    nodeScale: 1, cloudOpacity: 1, edgeOpacity: 1, maxLabels: 60, autoRotate: false, influencerEdges: false,
  };
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
    this.scene.add(this.composite.quad, this.edges.lines, this.nodes.points, this.arrows.group);
    this.pickScene.add(this.nodes.pickPoints);

    const p = arrays.position;
    this.centre.set(0, 0, 0);
    for (let i = 0; i < graph.n; i++) this.centre.add(new THREE.Vector3(p[3 * i], p[3 * i + 1], p[3 * i + 2]));
    if (graph.n) this.centre.divideScalar(graph.n);
    const dist = new Float32Array(graph.n);
    for (let i = 0; i < graph.n; i++) {
      dist[i] = Math.hypot(p[3 * i] - this.centre.x, p[3 * i + 1] - this.centre.y, p[3 * i + 2] - this.centre.z);
    }
    dist.sort();
    this.fitRadius = Math.max(1, dist[Math.floor(0.95 * (graph.n - 1))] ?? meta.extent);
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
    this.labelAlpha.clear();
    this.labelWidth.clear();
    this.updateTimes();
    this.updateSizes();
    this.applyStyle(MODE_STYLE[this.mode], false);
    this.resetView(false);
  }

  private unload(): void {
    for (const layer of [this.nodes, this.edges, this.clouds, this.arrows]) layer?.dispose();
    this.scene.clear();
    this.pickScene.clear();
    this.composite.scene.clear();
    this.nodes = this.edges = this.clouds = this.arrows = null;
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
    this.settings = { ...settings };
    this.controls.autoRotate = settings.autoRotate;
    this.controls.autoRotateSpeed = 0.6;
    if (this.nodes) this.nodes.material.uniforms.uSizeScale.value = settings.nodeScale;
    this.applyStyle(MODE_STYLE[this.mode], false);
    this.pickDirty = true;
  }

  select(node: number | null): void {
    if (!this.nodes || !this.edges || !this.graph) return;
    this.selected = node;
    const hl = new Float32Array(this.graph.n);
    const edges = new Set<number>();
    if (node !== null) {
      for (const { node: j, edge } of this.graph.neighbours(node)) {
        hl[j] = 1;
        edges.add(edge);
      }
      hl[node] = 2;
    }
    this.nodes.set('aHighlight', hl);
    this.edges.setHighlight(edges);
    const focus = node === null ? 0 : 1;
    this.nodes.material.uniforms.uFocus.value = focus;
    this.edges.material.uniforms.uFocus.value = focus;
  }

  selectCommunity(community: number | null): void {
    this.clouds?.setFocus(community);
  }

  /** Fly the camera to a node (or a point with a viewing distance). */
  flyTo(node: number): void {
    if (!this.graph) return;
    const target = new THREE.Vector3(...this.graph.position(node));
    const r = this.graph.arrays.radius[node];
    this.flyToPoint(target, Math.max(r * 25, this.fitRadius * 0.12));
  }

  flyToCommunity(community: number): void {
    const c = this.graph?.data.communities[community];
    if (c) this.flyToPoint(new THREE.Vector3(...c.centre), c.radius * 3.2);
  }

  resetView(animate = true): void {
    if (!this.graph) return;
    const distance = this.fitRadius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    const dir = new THREE.Vector3(0.35, 0.3, 1).normalize();
    if (!animate) {
      this.controls.target.copy(this.centre);
      this.camera.position.copy(this.centre).addScaledVector(dir, distance);
      this.controls.update();
      return;
    }
    this.flyToPoint(this.centre.clone(), distance, dir);
  }

  private flyToPoint(target: THREE.Vector3, distance: number, direction?: THREE.Vector3): void {
    const startTarget = this.controls.target.clone();
    const startPos = this.camera.position.clone();
    const dir = direction ?? startPos.clone().sub(startTarget).normalize();
    const endPos = target.clone().addScaledVector(dir, distance);
    this.tween(0, 1, 700, (v) => {
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
        this.edges.lines.visible = v.edges > 0.005;
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
    this.clouds.setActivity(communityActivity(arrays.community, this.tEff, this.time, absorbed, arrays.absorbed_count,
      sizes));
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
    if (this.styles.clouds > 0.5) {
      // community whose cloud centre is closest on screen, if the cursor is inside its projected radius
      let best = -1;
      let bestScore = Infinity;
      for (const c of this.graph.data.communities) {
        const centre = new THREE.Vector3(...c.centre);
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
    if (!graph || !this.nodes || this.settings.maxLabels <= 0) return;
    const { flags, position, label_priority } = graph.arrays;
    const radius = this.nodes.attr('aRadius').array as Float32Array;
    const vis = this.visTo;
    const cam = this.camera.position;
    const toCamera = cam.clone().sub(this.centre);
    const projScale = this.projScale(this.height) * this.settings.nodeScale;
    ctx.font = '600 12px Inter, "Segoe UI", system-ui, sans-serif';
    const candidates: LabelCandidate[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < graph.n; i++) {
      if (!isLabelled(flags[i]) || vis[i] < 0.5) continue;
      v.set(position[3 * i], position[3 * i + 1], position[3 * i + 2]);
      // facing the user: on the camera's side of the node cloud ...
      if ((v.x - this.centre.x) * toCamera.x + (v.y - this.centre.y) * toCamera.y
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
    const placed = placeLabels(candidates, this.width, this.height, this.settings.maxLabels);
    const keep = new Set<number>();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    for (const p of placed) {
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
      else this.onHover(this.styles.clouds > 0.5 || this.styles.arrows > 0.5
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
