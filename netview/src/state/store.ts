/** Application state: one set of Svelte stores shared by the panels and the viewport. */

import { get, writable } from 'svelte/store';

import { BundleClient } from '../data/client';
import { Graph } from '../data/graph';
import type { BundleData, ReachResult } from '../data/types';
import type { ViewMode } from '../filters/visibility';
import type { HoverInfo, SceneSettings } from '../render/NetworkScene';

export interface MediaGroup {
  id: string;
  name: string;
  colour: string;
  media: string[];
}

export const client = new BundleClient();

export const bundle = writable<BundleData | null>(null);
export const graph = writable<Graph | null>(null);
export const fileName = writable<string>('');
export const loading = writable<string | null>(null);
export const loadError = writable<string | null>(null);

export const viewMode = writable<ViewMode>('network');
export const seekerTime = writable<number>(0);
export const playing = writable(false);
/** 1 = the whole timeline in 40 seconds */
export const playSpeed = writable(1);

export const selectedMedia = writable<Set<string>>(new Set());
export const reach = writable<ReachResult | null>(null);
export const groups = writable<MediaGroup[]>([]);

/** Medium shown in the media viewer */
export const viewedMedia = writable<string | null>(null);
export const selectedNode = writable<number | null>(null);
export const selectedCommunity = writable<number | null>(null);
export const hovered = writable<HoverInfo | null>(null);
export const edgeTypes = writable<number>(0xff);

export const DEFAULT_SETTINGS: SceneSettings = {
  nodeScale: 1, cloudOpacity: 1, edgeOpacity: 1, maxLabels: 60, autoRotate: false, influencerEdges: false,
};
export const settings = writable<SceneSettings>(loadJson('netview.settings', DEFAULT_SETTINGS));

/** Requests from the panels to the viewport (fly to a node or community, reset the view). */
export type CameraRequest = { kind: 'node'; node: number } | { kind: 'community'; community: number } | { kind: 'reset' };
export const cameraRequest = writable<CameraRequest | null>(null);

// ---------------------------------------------------------------- browser storage (best effort)
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage: settings simply are not remembered */
  }
}

settings.subscribe((s) => saveJson('netview.settings', s));

function groupsKey(): string | null {
  const b = get(bundle);
  return b ? `netview.groups.${b.key}` : null;
}

groups.subscribe((g) => {
  const key = groupsKey();
  if (key) saveJson(key, g);
});

// ---------------------------------------------------------------- actions
export function openFile(file: File): Promise<void> {
  return openBundle(file.name, `Reading ${file.name} …`, () => file.arrayBuffer(), false);
}

/** Served next to the app (nginx in Docker, the Vite middleware in dev); 204 when none is configured. */
const DEFAULT_DATASET_URL = 'data/default.netview';

/** Open the server's default bundle, if there is one; otherwise the drop zone stays. */
export async function openDefaultDataset(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(DEFAULT_DATASET_URL, { cache: 'no-cache' });
  } catch {
    return;
  }
  if (response.status !== 200) return;
  await openBundle('default.netview', 'Downloading the default bundle …', () => response.arrayBuffer(), true);
}

/** ``served``: the server's own bundle, whose media files it serves under data/media/. A file opened from
 * disk may come from anywhere, so its media files are not looked up. */
async function openBundle(name: string, message: string, read: () => Promise<ArrayBuffer>,
                          served: boolean): Promise<void> {
  loading.set(message);
  loadError.set(null);
  try {
    const buffer = await read();
    if (!buffer.byteLength) throw new Error(`${name} is empty`);
    loading.set('Opening the bundle …');
    const data = await client.open(buffer);
    if (!served) for (const m of data.media) m.files = [];
    selectedMedia.set(new Set());
    viewedMedia.set(null);
    reach.set(null);
    selectedNode.set(null);
    selectedCommunity.set(null);
    hovered.set(null);
    playing.set(false);
    seekerTime.set(data.meta.t_max);
    bundle.set(data);
    graph.set(new Graph(data));
    fileName.set(name);
    let stored: MediaGroup[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(`netview.groups.${data.key}`) ?? '[]');
    } catch {
      stored = [];
    }
    groups.set(Array.isArray(stored) ? stored : []);
  } catch (err) {
    loadError.set((err as Error).message);
  } finally {
    loading.set(null);
  }
}

let reachRequest = 0;
/** Recompute the reach whenever the media selection changes (latest request wins). */
selectedMedia.subscribe(async (media) => {
  const id = ++reachRequest;
  if (!media.size || !get(bundle)) {
    reach.set(null);
    return;
  }
  const result = await client.reach([...media]);
  if (id === reachRequest) reach.set(result);
});

export function toggleMedia(pk: string, on?: boolean): void {
  selectedMedia.update((s) => {
    const next = new Set(s);
    const add = on ?? !next.has(pk);
    if (add) next.add(pk);
    else next.delete(pk);
    return next;
  });
}

export function setMediaSelection(pks: Iterable<string>): void {
  selectedMedia.set(new Set(pks));
}

export function selectNode(node: number | null): void {
  selectedNode.set(node);
  if (node !== null) selectedCommunity.set(null);
}

export function selectCommunity(c: number | null): void {
  selectedCommunity.set(c);
  if (c !== null) selectedNode.set(null);
}
