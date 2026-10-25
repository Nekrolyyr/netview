<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { NetworkScene } from '../render/NetworkScene';
  import {
    bundle, cameraRequest, edgeTypes, graph, hovered, reach, seekerTime, selectCommunity, selectNode,
    selectedCommunity, selectedNode, settings, viewMode,
  } from '../state/store';
  import { compact, signed } from './format';

  let container: HTMLDivElement;
  let scene: NetworkScene | null = $state(null);

  onMount(() => {
    const s = new NetworkScene(container);
    s.onHover = (info) => hovered.set(info);
    s.onClick = (info) => {
      if (!info) {
        selectNode(null);
        selectCommunity(null);
      } else if (info.kind === 'node') selectNode(info.node);
      else if (info.kind === 'community') selectCommunity(info.community);
    };
    scene = s;
  });

  onDestroy(() => scene?.dispose());

  $effect(() => {
    if (scene && $graph) scene.load($graph);
  });
  $effect(() => {
    if (scene && $graph) scene.setMode($viewMode);
  });
  $effect(() => {
    if (scene && $graph) scene.setTime($seekerTime);
  });
  $effect(() => {
    if (scene && $graph) scene.setReach($reach);
  });
  $effect(() => {
    if (scene && $graph) scene.setEdgeTypes($edgeTypes);
  });
  $effect(() => {
    if (scene && $graph) scene.setSettings($settings);
  });
  $effect(() => {
    if (scene && $graph) scene.select($selectedNode);
  });
  $effect(() => {
    if (scene && $graph) scene.selectCommunity($selectedCommunity);
  });
  $effect(() => {
    const req = $cameraRequest;
    if (!scene || !req) return;
    if (req.kind === 'node') scene.flyTo(req.node);
    else if (req.kind === 'community') scene.flyToCommunity(req.community);
    else scene.resetView();
    cameraRequest.set(null);
  });

  const tip = $derived.by(() => {
    const h = $hovered;
    const g = $graph;
    if (!h || !g) return null;
    if (h.kind === 'node') {
      const followers = g.arrays.label_priority[h.node];
      const absorbed = g.arrays.absorbed_count[h.node];
      return {
        x: h.x, y: h.y, title: `@${g.name(h.node)}`,
        detail: [followers ? `${compact(followers)} followers` : null, absorbed ? `+${compact(absorbed)} absorbed` : null]
          .filter(Boolean).join(' · '),
      };
    }
    if (h.kind === 'community') {
      const c = g.data.communities[h.community];
      return { x: h.x, y: h.y, title: c.label, detail: `${compact(c.sizeWithAbsorbed)} users · sentiment ${signed(c.meanSentiment)}` };
    }
    const a = h.arrow;
    return { x: h.x, y: h.y, title: `${a.from} → ${a.to}`, detail: `mean ${signed(a.link.mean)} · ${a.link.n} comments · sd ${a.link.std.toFixed(2)}` };
  });
</script>

<div class="viewport" bind:this={container} class:hovering={!!$hovered} data-testid="viewport">
  {#if tip}
    <div class="tip" style="left: {tip.x + 14}px; top: {tip.y + 14}px">
      <div class="tip-title">{tip.title}</div>
      {#if tip.detail}<div class="muted">{tip.detail}</div>{/if}
    </div>
  {/if}
  {#if $bundle && $reach}
    <div class="filter-badge">
      Media filter: <b class="num">{compact($reach.direct)}</b> reached directly, <b class="num">{compact($reach.hop)}</b> one hop
    </div>
  {/if}
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    cursor: grab;
  }

  .viewport:active {
    cursor: grabbing;
  }

  .viewport.hovering {
    cursor: pointer;
  }

  .tip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    background: rgb(26 21 36 / 0.94);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 9px;
    max-width: 320px;
    font-size: 12px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.4);
  }

  .tip-title {
    font-weight: 600;
  }

  .filter-badge {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 4;
    background: rgb(26 21 36 / 0.85);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--muted);
  }

  .filter-badge b {
    color: var(--text);
  }
</style>
