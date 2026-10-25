/** Graph helpers over the bundle arrays (CSR adjacency, members, search). */

import { FLAG, UNCLUSTERED, type BundleData } from './types';

export class Graph {
  readonly n: number;
  readonly members: number[][];
  private lowerNames: string[];

  constructor(readonly data: BundleData) {
    this.n = data.meta.node_count;
    this.members = data.communities.map(() => []);
    const community = data.arrays.community;
    for (let i = 0; i < this.n; i++) {
      if (community[i] !== UNCLUSTERED) this.members[community[i]]?.push(i);
    }
    this.lowerNames = data.usernames.map((u) => (u ?? '').toLowerCase());
  }

  get arrays() {
    return this.data.arrays;
  }

  /** Neighbour node indices and the edge index of each link. */
  neighbours(i: number): { node: number; edge: number }[] {
    const { adj_offsets, adj_nodes, adj_edges } = this.data.arrays;
    const out = [];
    for (let k = adj_offsets[i]; k < adj_offsets[i + 1]; k++) out.push({ node: adj_nodes[k], edge: adj_edges[k] });
    return out;
  }

  degree(i: number): number {
    const o = this.data.arrays.adj_offsets;
    return o[i + 1] - o[i];
  }

  position(i: number): [number, number, number] {
    const p = this.data.arrays.position;
    return [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  }

  has(i: number, flag: number): boolean {
    return (this.data.arrays.flags[i] & flag) !== 0;
  }

  isInfluencer(i: number): boolean {
    return this.has(i, FLAG.influencer);
  }

  name(i: number): string {
    return this.data.usernames[i] ?? `#${i}`;
  }

  /** Usernames starting with (then containing) the query, influencers first. */
  search(query: string, limit = 10): number[] {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return [];
    const prefix: number[] = [];
    const inner: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const name = this.lowerNames[i];
      if (name.startsWith(q)) prefix.push(i);
      else if (name.includes(q)) inner.push(i);
    }
    const rank = (a: number, b: number) => this.data.arrays.label_priority[b] - this.data.arrays.label_priority[a];
    return [...prefix.sort(rank), ...inner.sort(rank)].slice(0, limit);
  }
}
