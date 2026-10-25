/** Main-thread client of the bundle worker (promise per request). */

import type { SqlValue } from 'sql.js';

import type { BundleData, ReachResult, Row } from './types';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class BundleClient {
  private worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private next = 1;
  private thumbs = new Map<string, Promise<string | null>>();

  constructor() {
    this.worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
  }

  private call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, ...message }, transfer);
    });
  }

  open(buffer: ArrayBuffer): Promise<BundleData> {
    for (const url of this.thumbs.values()) url.then((u) => u && URL.revokeObjectURL(u));
    this.thumbs.clear();
    return this.call<BundleData>({ type: 'open', buffer }, [buffer]);
  }

  query<T extends Row = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.call<T[]>({ type: 'query', sql, params });
  }

  reach(media: string[]): Promise<ReachResult> {
    return this.call<ReachResult>({ type: 'reach', media });
  }

  /** Media whose reach contains the node (1 = interacted, 2 = one hop). */
  mediaOf(node: number): Promise<{ pk: string; level: 1 | 2; t: number }[]> {
    return this.call({ type: 'mediaOf', node });
  }

  /** Object URL of a medium's thumbnail (cached), or null. */
  thumbnail(pk: string): Promise<string | null> {
    let hit = this.thumbs.get(pk);
    if (!hit) {
      hit = this.call<Uint8Array | null>({ type: 'thumbnail', pk }).then((bytes) =>
        bytes ? URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })) : null,
      );
      this.thumbs.set(pk, hit);
    }
    return hit;
  }
}
