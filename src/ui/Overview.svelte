<script lang="ts">
  import { FLAG, T_KIND } from '../data/types';
  import { bundle, graph, selectCommunity, cameraRequest } from '../state/store';
  import { compact, formatDate, formatRel, signed } from './format';

  const stats = $derived.by(() => {
    const g = $graph;
    if (!g) return null;
    const { flags, t_kind } = g.arrays;
    let whitelist = 0;
    let influencer = 0;
    let unclustered = 0;
    const kinds = [0, 0, 0];
    for (let i = 0; i < g.n; i++) {
      if (flags[i] & FLAG.whitelist) whitelist++;
      if (flags[i] & FLAG.influencer) influencer++;
      if (flags[i] & FLAG.unclustered) unclustered++;
      kinds[t_kind[i]]++;
    }
    return { whitelist, influencer, unclustered, kinds };
  });
  const communities = $derived([...($bundle?.communities ?? [])].sort((a, b) => b.sizeWithAbsorbed - a.sizeWithAbsorbed));
</script>

{#if $bundle && stats}
  {@const m = $bundle.meta}
  <h2 class="title">Network</h2>
  <p class="muted intro">Click a node or a community cloud for details. Drag to rotate, scroll to zoom,
    right-drag to pan.</p>
  <dl class="facts">
    <dt>Visible nodes</dt><dd class="num">{compact(m.node_count)}</dd>
    <dt>Absorbed accounts</dt><dd class="num">{compact(m.absorbed_total)}</dd>
    <dt>Links</dt><dd class="num">{compact(m.edge_count)}</dd>
    <dt>Source accounts</dt><dd class="num">{stats.whitelist}</dd>
    <dt>Influencers</dt><dd class="num">{stats.influencer}</dd>
    <dt>Not in a community</dt><dd class="num">{compact(stats.unclustered)}</dd>
    <dt>Time range</dt><dd class="num">{formatRel(m.t0, m.t_min)} – {formatRel(m.t0, m.t_max)}</dd>
    <dt>Activation</dt><dd class="num">{compact(stats.kinds[T_KIND.exact])} exact · {compact(stats.kinds[T_KIND.derived])} one hop ·
      {compact(stats.kinds[T_KIND.none])} none</dd>
    <dt>Exported</dt><dd class="num">{formatDate(Date.parse(m.built_at) / 1000)}{m.pseudonymized ? ' · pseudonymized' : m.anonymized_below != null ? ` · accounts < ${compact(m.anonymized_below)} followers anonymised` : ''}</dd>
  </dl>

  <h3 class="section-title">Communities</h3>
  <ul class="communities">
    {#each communities as c (c.id)}
      <li>
        <button onclick={() => { selectCommunity(c.id); cameraRequest.set({ kind: 'community', community: c.id }); }}>
          <span class="dot" style="background: {c.colour}"></span>
          <span class="label">{c.label}</span>
          <span class="faint num">{compact(c.sizeWithAbsorbed)}</span>
          <span class="num sent" style="color: {c.meanSentiment == null ? 'var(--faint)' : c.meanSentiment >= 0 ? 'var(--positive)' : 'var(--negative)'}">{signed(c.meanSentiment, 1)}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .title {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .intro {
    margin: 0 0 12px;
    font-size: 12px;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0 0 16px;
    font-size: 12px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    text-align: right;
  }

  .communities {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .communities button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: 0;
    padding: 4px 4px;
    border-radius: 6px;
    text-align: left;
    font-size: 12px;
  }

  .communities button:hover {
    background: var(--panel-2);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sent {
    width: 36px;
    text-align: right;
  }
</style>
