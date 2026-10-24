/** Data of a `.netview` bundle as the viewer uses it (see the analyzer's viewer_export/bundle.py). */

export const SCHEMA_VERSION = 1;

export const FLAG = {
  whitelist: 1,
  influencer: 2,
  verified: 4,
  private: 8,
  hasAbsorbed: 16,
  unclustered: 32,
} as const;

export const EDGE_TYPES = ['follow', 'like', 'comment', 'reply', 'mention', 'tag', 'coauthor', 'repost'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export const EDGE_BIT: Record<EdgeType, number> = Object.fromEntries(
  EDGE_TYPES.map((t, i) => [t, 1 << i]),
) as Record<EdgeType, number>;

export const UNCLUSTERED = 0xffff;
export const T_KIND = { none: 0, exact: 1, derived: 2 } as const;

export interface Meta {
  schema_version: number;
  built_at: string;
  dataset_built_at: string | null;
  community_run_id: number;
  influencer_min: number;
  /** Unix seconds of time 0; all times in arrays are seconds since t0. */
  t0: number;
  t_min: number;
  t_max: number;
  node_count: number;
  edge_count: number;
  pseudonymized: boolean;
  no_text: boolean;
  colours: Record<string, string>;
  size_base: number;
  size_k: number;
  sentiment_prompt: string | null;
  stance_prompt: string | null;
  extent: number;
  absorbed_total: number;
}

export interface Arrays {
  position: Float32Array;
  radius: Float32Array;
  absorbed_count: Uint32Array;
  community: Uint16Array;
  flags: Uint8Array;
  t_act: Float32Array;
  t_kind: Uint8Array;
  label_priority: Float32Array;
  edge_src: Uint32Array;
  edge_dst: Uint32Array;
  edge_types: Uint8Array;
  edge_dir: Uint8Array;
  edge_weight: Float32Array;
  edge_t: Float32Array;
  adj_offsets: Uint32Array;
  adj_nodes: Uint32Array;
  adj_edges: Uint32Array;
  absorbed_offsets: Uint32Array;
  absorbed_t: Float32Array;
}

export const ARRAY_NAMES: (keyof Arrays)[] = [
  'position', 'radius', 'absorbed_count', 'community', 'flags', 't_act', 't_kind', 'label_priority',
  'edge_src', 'edge_dst', 'edge_types', 'edge_dir', 'edge_weight', 'edge_t',
  'adj_offsets', 'adj_nodes', 'adj_edges', 'absorbed_offsets', 'absorbed_t',
];

export interface CommunityInfo {
  id: number;
  label: string;
  colour: string;
  isSource: boolean;
  size: number;
  sizeWithAbsorbed: number;
  centre: [number, number, number];
  radius: number;
  sphereRadius: number;
  /** x, y, z, radius per splat */
  splats: Float32Array;
  meanSentiment: number | null;
  nRated: number | null;
  topUsers: string[];
  topFeatures: string[];
}

export interface SentimentLink {
  src: number;
  dst: number;
  mean: number;
  n: number;
  std: number;
}

export interface OverlapLink {
  a: number;
  b: number;
  overlap: number;
}

export interface MediaInfo {
  pk: string;
  code: string | null;
  ownerIdx: number | null;
  owner: string | null;
  kind: string | null;
  /** unix seconds */
  takenAt: number | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  meanSentiment: number | null;
  nRated: number | null;
  directCount: number;
  hopCount: number;
  absorbedReached: number;
  hasThumbnail: boolean;
}

export interface TimelineDay {
  day: string;
  exact: number;
  derived: number;
}

export interface BundleData {
  meta: Meta;
  arrays: Arrays;
  usernames: (string | null)[];
  communities: CommunityInfo[];
  sentiment: SentimentLink[];
  overlap: OverlapLink[];
  media: MediaInfo[];
  timeline: TimelineDay[];
  /** identifies the bundle for per-bundle browser storage (media groups) */
  key: string;
}

/** Reach of a media selection: time per node (Infinity = not reached) and level (0, 1 direct, 2 hop). */
export interface ReachResult {
  time: Float32Array;
  level: Uint8Array;
  direct: number;
  hop: number;
  absorbed: number;
}

export type Row = Record<string, unknown>;
