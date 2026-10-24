/** Decoding of the bundle's typed-array BLOBs and JSON meta values. Pure functions (unit tested). */

import type { Arrays, Meta } from './types';

const CONSTRUCTORS = {
  f32: Float32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array,
} as const;

export type DType = keyof typeof CONSTRUCTORS;

/**
 * BLOB bytes -> typed array. The bytes are copied into a fresh buffer: SQLite BLOBs are not
 * guaranteed to be aligned, and the result is transferred out of the worker.
 */
export function decodeArray(bytes: Uint8Array, dtype: DType): Arrays[keyof Arrays] {
  const Ctor = CONSTRUCTORS[dtype];
  if (!Ctor) throw new Error(`unknown dtype ${dtype}`);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  if (copy.byteLength % Ctor.BYTES_PER_ELEMENT) throw new Error(`blob length ${copy.byteLength} is not a multiple of ${dtype}`);
  return new Ctor(copy.buffer) as Arrays[keyof Arrays];
}

/** meta(key, value) rows: values are JSON except for plain strings. */
export function decodeMeta(rows: [string, string][]): Meta {
  const out: Record<string, unknown> = {};
  for (const [key, value] of rows) {
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  return out as unknown as Meta;
}

export function parseJsonList(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Union of the reach of several media: per node the earliest time and the best level.
 * `time` must be filled with Infinity and `level` with 0 before the first call.
 */
export function mergeReach(time: Float32Array, level: Uint8Array, idx: Uint32Array, t: Float32Array, lvl: 1 | 2): void {
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (t[k] < time[i]) time[i] = t[k];
    if (level[i] === 0 || lvl < level[i]) level[i] = lvl;
  }
}
