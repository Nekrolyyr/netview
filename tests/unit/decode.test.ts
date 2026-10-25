import { describe, expect, it } from 'vitest';

import { decodeArray, decodeMeta, mergeReach, parseJsonList } from '../../src/data/decode';

describe('decodeArray', () => {
  it('reads little-endian float32 and uint32 BLOBs, also from unaligned offsets', () => {
    const f = new Float32Array([1.5, -2, Infinity]);
    const raw = new Uint8Array(f.byteLength + 1);
    raw.set(new Uint8Array(f.buffer), 1);
    const decoded = decodeArray(raw.subarray(1), 'f32') as Float32Array;
    expect(Array.from(decoded)).toEqual([1.5, -2, Infinity]);
    const u = new Uint32Array([0, 7, 4294967295]);
    expect(Array.from(decodeArray(new Uint8Array(u.buffer), 'u32'))).toEqual([0, 7, 4294967295]);
  });

  it('rejects lengths that do not fit the type', () => {
    expect(() => decodeArray(new Uint8Array(5), 'f32')).toThrow();
  });
});

describe('decodeMeta', () => {
  it('parses JSON values and keeps plain strings', () => {
    const meta = decodeMeta([['schema_version', '1'], ['built_at', '2026-10-24T14:00:00+00:00'],
      ['colours', '{"whitelist": "#ff2a2a"}'], ['pseudonymized', 'false']]);
    expect(meta.schema_version).toBe(1);
    expect(meta.built_at).toBe('2026-10-24T14:00:00+00:00');
    expect(meta.colours.whitelist).toBe('#ff2a2a');
    expect(meta.pseudonymized).toBe(false);
  });

  it('parseJsonList tolerates bad input', () => {
    expect(parseJsonList('["a", "b"]')).toEqual(['a', 'b']);
    expect(parseJsonList('nope')).toEqual([]);
    expect(parseJsonList(null)).toEqual([]);
  });
});

describe('mergeReach', () => {
  it('keeps the earliest time and the best level over several media', () => {
    const time = new Float32Array(4).fill(Infinity);
    const level = new Uint8Array(4);
    mergeReach(time, level, new Uint32Array([0, 2]), new Float32Array([50, 10]), 2);
    mergeReach(time, level, new Uint32Array([2, 3]), new Float32Array([20, 5]), 1);
    expect(Array.from(time)).toEqual([50, Infinity, 10, 5]);
    expect(Array.from(level)).toEqual([2, 0, 1, 1]);
  });
});
