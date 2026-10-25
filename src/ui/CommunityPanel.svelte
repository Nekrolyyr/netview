<script lang="ts">
  import { bundle, cameraRequest, graph, selectCommunity, selectNode } from '../state/store';
  import { compact, sentimentColour, signed } from './format';

  let { community }: { community: number } = $props();

  const c = $derived($bundle!.communities[community]);
  const communities = $derived($bundle!.communities);
  const outgoing = $derived($bundle!.sentiment.filter((s) => s.src === community).sort((a, b) => b.n - a.n));
  const incoming = $derived($bundle!.sentiment.filter((s) => s.dst === community).sort((a, b) => b.n - a.n));
  const overlaps = $derived($bundle!.overlap
    .filter((o) => o.a === community || o.b === community)
    .map((o) => ({ other: o.a === community ? o.b : o.a, overlap: o.overlap }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 8));
  const members = $derived.by(() => {
    const g = $graph!;
    return [...(g.members[community] ?? [])]
      .sort((a, b) => g.arrays.label_priority[b] - g.arrays.label_priority[a] || g.arrays.absorbed_count[b] - g.arrays.absorbed_count[a])
      .slice(0, 60);
  });
</script>

<div class="head">
  <span class="dot big" style="background: {c.colour}"></span>
  <div class="who">
    <h2>{c.label}</h2>
    <div class="muted">{c.isSource ? 'Whitelist accounts without another community' : `Community ${c.id + 1}`}</div>
  </div>
  <button class="btn ghost small" title="Fly to" onclick={() => cameraRequest.set({ kind: 'community', community })}>◎</button>
  <button class="btn ghost small" title="Close" onclick={() => selectCommunity(null)}>✕</button>
</div>

<dl class="facts">
  <dt>Visible members</dt><dd class="num">{compact(c.size)}</dd>
  <dt>With absorbed</dt><dd class="num">{compact(c.sizeWithAbsorbed)}</dd>
  <dt>Mean sentiment</dt><dd class="num" style="color: {sentimentColour(c.meanSentiment)}">{signed(c.meanSentiment)}
    {#if c.nRated}<span class="faint">({compact(c.nRated)} comments)</span>{/if}</dd>
</dl>

{#if c.topFeatures.length}
  <section>
    <h3 class="section-title">Shared features</h3>
    <ul class="features">{#each c.topFeatures as f (f)}<li>{f}</li>{/each}</ul>
  </section>
{/if}

{#snippet sentimentTable(rows: typeof outgoing, key: 'src' | 'dst')}
  <table>
    <tbody>
      {#each rows as s (s.src + '-' + s.dst)}
        {@const other = communities[s[key]]}
        <tr>
          <td><button class="link" onclick={() => selectCommunity(other.id)}><span class="dot" style="background: {other.colour}"></span>
            {other.label}</button></td>
          <td class="bar-cell"><div class="bar"><div style="left: {s.mean >= 0 ? 50 : 50 + s.mean * 10}%; width: {Math.abs(s.mean) * 10}%; background: {sentimentColour(s.mean)}"></div></div></td>
          <td class="num" style="color: {sentimentColour(s.mean)}">{signed(s.mean, 1)}</td>
          <td class="num faint">{compact(s.n)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<section>
  <h3 class="section-title">Sentiment towards others</h3>
  {#if outgoing.length}{@render sentimentTable(outgoing, 'dst')}{:else}<p class="faint">Not enough rated comments.</p>{/if}
</section>
<section>
  <h3 class="section-title">Sentiment from others</h3>
  {#if incoming.length}{@render sentimentTable(incoming, 'src')}{:else}<p class="faint">Not enough rated comments.</p>{/if}
</section>

{#if overlaps.length}
  <section>
    <h3 class="section-title">Overlaps most with</h3>
    <ul class="plain">
      {#each overlaps as o (o.other)}
        <li><button class="link" onclick={() => selectCommunity(o.other)}><span class="dot" style="background: {communities[o.other].colour}"></span>
          {communities[o.other].label}</button><span class="num faint">{(o.overlap * 100).toFixed(1)}%</span></li>
      {/each}
    </ul>
  </section>
{/if}

<section>
  <h3 class="section-title">Members</h3>
  <ul class="plain">
    {#each members as m (m)}
      <li><button class="link" onclick={() => selectNode(m)}>@{$graph?.name(m)}</button>
        <span class="num faint">{compact($graph?.arrays.label_priority[m] || null)}</span></li>
    {/each}
    {#if c.size > members.length}<li class="faint">… and {compact(c.size - members.length)} more</li>{/if}
  </ul>
</section>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 10px;
  }

  .dot.big {
    width: 14px;
    height: 14px;
    margin-top: 5px;
  }

  .who {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0 0 14px;
    font-size: 12px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    text-align: right;
  }

  section {
    margin-bottom: 14px;
    font-size: 12px;
  }

  .features {
    margin: 0;
    padding-left: 16px;
    color: var(--muted);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  td {
    padding: 2px 2px;
    white-space: nowrap;
  }

  td:first-child {
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-cell {
    width: 70px;
  }

  .bar {
    position: relative;
    height: 4px;
    background: #2c2439;
    border-radius: 2px;
  }

  .bar div {
    position: absolute;
    top: 0;
    height: 4px;
    border-radius: 2px;
  }

  td.num {
    text-align: right;
  }

  .link {
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    color: var(--text);
  }

  .link:hover {
    text-decoration: underline;
  }

  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .plain li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 1px 0;
  }
</style>
