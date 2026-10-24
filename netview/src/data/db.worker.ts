/// <reference lib="webworker" />
/**
 * Bundle worker: opens the `.netview` SQLite file with sql.js and answers the main thread.
 *
 * - open:      bundle buffer -> everything the renderer needs (typed arrays are transferred)
 * - query:     SQL for the info panels
 * - reach:     union of the reach of the selected media (time and level per node)
 * - thumbnail: WebP bytes of a medium
 * - mediaOf:   the media that reached a node (directly or one hop)
 */

import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import { decodeArray, decodeMeta, mergeReach, parseJsonList, type DType } from './decode';
import {
  ARRAY_NAMES, SCHEMA_VERSION, type Arrays, type BundleData, type CommunityInfo, type MediaInfo, type ReachResult,
} from './types';

let db: Database | null = null;
let nodeCount = 0;
const reachCache = new Map<string, { d: Uint32Array; dt: Float32Array; h: Uint32Array; ht: Float32Array; a: number }>();

type Request =
  | { id: number; type: 'open'; buffer: ArrayBuffer }
  | { id: number; type: 'query'; sql: string; params?: SqlValue[] }
  | { id: number; type: 'reach'; media: string[] }
  | { id: number; type: 'thumbnail'; pk: string }
  | { id: number; type: 'mediaOf'; node: number };

function rows(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
  if (!db) throw new Error('no bundle open');
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out: Record<string, unknown>[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

function hasTable(name: string): boolean {
  return rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0;
}

async function open(buffer: ArrayBuffer): Promise<{ data: BundleData; transfer: Transferable[] }> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  db?.close();
  reachCache.clear();
  try {
    db = new SQL.Database(new Uint8Array(buffer));
    if (!hasTable('meta') || !hasTable('arrays')) throw new Error('not a netview bundle');
  } catch (err) {
    db = null;
    throw new Error(`This file is not a netview bundle (${(err as Error).message}).`);
  }
  const meta = decodeMeta(rows('SELECT key, value FROM meta').map((r) => [String(r.key), String(r.value)]));
  if (meta.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Bundle schema ${meta.schema_version} is not supported (this viewer reads schema ${SCHEMA_VERSION}). `
      + 'Export it again with the matching har-analyzer version.');
  }
  nodeCount = meta.node_count;

  const arrays = {} as Arrays;
  const transfer: Transferable[] = [];
  const stored = new Map(rows('SELECT name, dtype, data FROM arrays').map((r) => [String(r.name), r]));
  for (const name of ARRAY_NAMES) {
    const row = stored.get(name);
    if (!row) throw new Error(`bundle is missing the array '${name}'`);
    const arr = decodeArray(row.data as Uint8Array, row.dtype as DType);
    (arrays as unknown as Record<string, unknown>)[name] = arr;
    transfer.push(arr.buffer);
  }

  const usernames = rows('SELECT idx, username FROM nodes ORDER BY idx').map((r) => (r.username as string | null) ?? null);
  const communities: CommunityInfo[] = rows('SELECT * FROM communities ORDER BY id').map((r) => ({
    id: Number(r.id),
    label: String(r.label ?? ''),
    colour: String(r.colour),
    isSource: Boolean(r.is_source),
    size: Number(r.size),
    sizeWithAbsorbed: Number(r.size_with_absorbed),
    centre: [Number(r.cx), Number(r.cy), Number(r.cz)],
    radius: Number(r.radius),
    sphereRadius: Number(r.sphere_radius),
    splats: decodeArray(r.splats as Uint8Array, 'f32') as Float32Array,
    meanSentiment: r.mean_sentiment == null ? null : Number(r.mean_sentiment),
    nRated: r.n_rated == null ? null : Number(r.n_rated),
    topUsers: parseJsonList(r.top_users),
    topFeatures: parseJsonList(r.top_features),
  }));
  const sentiment = rows('SELECT src, dst, mean, n, std FROM community_sentiment').map((r) => ({
    src: Number(r.src), dst: Number(r.dst), mean: Number(r.mean), n: Number(r.n), std: Number(r.std),
  }));
  const overlap = rows('SELECT a, b, overlap FROM community_overlap').map((r) => ({
    a: Number(r.a), b: Number(r.b), overlap: Number(r.overlap),
  }));
  const media: MediaInfo[] = rows(`
    SELECT m.media_pk, m.code, m.owner_idx, m.owner_username, m.kind, m.taken_at, m.caption, m.like_count,
           m.comment_count, m.mean_sentiment, m.n_rated, m.thumbnail IS NOT NULL AS has_thumb,
           r.direct_count, r.hop_count, r.absorbed_reached
      FROM media m LEFT JOIN media_reach r USING (media_pk)
     ORDER BY m.taken_at DESC`).map((r) => ({
    pk: String(r.media_pk),
    code: (r.code as string | null) ?? null,
    ownerIdx: r.owner_idx == null ? null : Number(r.owner_idx),
    owner: (r.owner_username as string | null) ?? null,
    kind: (r.kind as string | null) ?? null,
    takenAt: r.taken_at == null ? null : Number(r.taken_at),
    caption: (r.caption as string | null) ?? null,
    likes: r.like_count == null ? null : Number(r.like_count),
    comments: r.comment_count == null ? null : Number(r.comment_count),
    meanSentiment: r.mean_sentiment == null ? null : Number(r.mean_sentiment),
    nRated: r.n_rated == null ? null : Number(r.n_rated),
    directCount: Number(r.direct_count ?? 0),
    hopCount: Number(r.hop_count ?? 0),
    absorbedReached: Number(r.absorbed_reached ?? 0),
    hasThumbnail: Boolean(r.has_thumb),
  }));
  const timeline = rows('SELECT day, exact, derived FROM timeline ORDER BY day').map((r) => ({
    day: String(r.day), exact: Number(r.exact), derived: Number(r.derived),
  }));
  for (const c of communities) transfer.push(c.splats.buffer);
  const key = `${meta.built_at}|${meta.node_count}|${meta.edge_count}`;
  return { data: { meta, arrays, usernames, communities, sentiment, overlap, media, timeline, key }, transfer };
}

function reachOf(pk: string) {
  let hit = reachCache.get(pk);
  if (!hit) {
    const [r] = rows('SELECT direct_idx, direct_t, hop_idx, hop_t, absorbed_reached FROM media_reach WHERE media_pk = ?', [pk]);
    if (!r) return null;
    hit = {
      d: decodeArray(r.direct_idx as Uint8Array, 'u32') as Uint32Array,
      dt: decodeArray(r.direct_t as Uint8Array, 'f32') as Float32Array,
      h: decodeArray(r.hop_idx as Uint8Array, 'u32') as Uint32Array,
      ht: decodeArray(r.hop_t as Uint8Array, 'f32') as Float32Array,
      a: Number(r.absorbed_reached ?? 0),
    };
    reachCache.set(pk, hit);
  }
  return hit;
}

function reach(media: string[]): ReachResult {
  const time = new Float32Array(nodeCount).fill(Infinity);
  const level = new Uint8Array(nodeCount);
  let absorbed = 0;
  for (const pk of media) {
    const r = reachOf(pk);
    if (!r) continue;
    mergeReach(time, level, r.d, r.dt, 1);
    mergeReach(time, level, r.h, r.ht, 2);
    absorbed += r.a;     // an upper bound: the same leaf can be reached by several media
  }
  let direct = 0;
  let hop = 0;
  for (let i = 0; i < nodeCount; i++) {
    if (level[i] === 1) direct++;
    else if (level[i] === 2) hop++;
  }
  return { time, level, direct, hop, absorbed };
}

/** Media whose reach contains the node: level 1 = interacted, 2 = one hop. */
function mediaOf(node: number): { pk: string; level: 1 | 2; t: number }[] {
  const out: { pk: string; level: 1 | 2; t: number }[] = [];
  for (const { media_pk: pk } of rows('SELECT media_pk FROM media_reach')) {
    const r = reachOf(String(pk));
    if (!r) continue;
    const d = binarySearch(r.d, node);
    if (d >= 0) {
      out.push({ pk: String(pk), level: 1, t: r.dt[d] });
      continue;
    }
    const h = binarySearch(r.h, node);
    if (h >= 0) out.push({ pk: String(pk), level: 2, t: r.ht[h] });
  }
  return out;
}

function binarySearch(arr: Uint32Array, x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === x) return mid;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    switch (req.type) {
      case 'open': {
        const { data, transfer } = await open(req.buffer);
        self.postMessage({ id: req.id, ok: true, result: data }, transfer);
        break;
      }
      case 'query':
        self.postMessage({ id: req.id, ok: true, result: rows(req.sql, req.params) });
        break;
      case 'reach': {
        const result = reach(req.media);
        self.postMessage({ id: req.id, ok: true, result }, [result.time.buffer, result.level.buffer]);
        break;
      }
      case 'mediaOf':
        self.postMessage({ id: req.id, ok: true, result: mediaOf(req.node) });
        break;
      case 'thumbnail': {
        const [r] = rows('SELECT thumbnail FROM media WHERE media_pk = ?', [req.pk]);
        self.postMessage({ id: req.id, ok: true, result: (r?.thumbnail as Uint8Array | null) ?? null });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: (err as Error).message });
  }
};
