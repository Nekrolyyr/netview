<script lang="ts">
  import type { ViewMode } from '../filters/visibility';
  import {
    bundle, cameraRequest, fileName, graph, openFile, selectedMedia, selectNode, setMediaSelection, viewMode,
  } from '../state/store';
  import { compact } from './format';
  import Legend from './Legend.svelte';
  import Settings from './Settings.svelte';

  let { leftOpen = $bindable(false), rightOpen = $bindable(false) } = $props();

  const MODES: { id: ViewMode; label: string; key: string; title: string }[] = [
    { id: 'network', label: 'Network', key: '1', title: 'Nodes and links, communities faint' },
    { id: 'community', label: 'Community', key: '2', title: 'Community clouds and their sentiment towards each other' },
    { id: 'influencer', label: 'Influencer', key: '3', title: 'Accounts with many followers on top of the communities' },
    { id: 'sentiment', label: 'Sentiment', key: '4', title: 'Communities from hostile (left) to supportive (right) towards the GSF' },
    { id: 'radial', label: 'Radial', key: '5', title: 'Source accounts in the middle; the more members linked to them, the closer a community' },
    { id: 'ring', label: 'Ring', key: '6', title: 'Communities on a ring by size, source accounts in the middle' },
    { id: 'sphere', label: 'Sphere', key: '7', title: 'Every account on a ball, communities as coloured areas, links along the surface' },
  ];

  let query = $state('');
  let active = $state(0);
  let showLegend = $state(false);
  let showSettings = $state(false);
  let fileInput: HTMLInputElement;

  const results = $derived($graph && query.trim() ? $graph.search(query, 8) : []);

  function choose(node: number) {
    selectNode(node);
    cameraRequest.set({ kind: 'node', node });
    query = '';
    // hand the keyboard back to the shortcuts (Esc, 1/2/3, Space …)
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      active = Math.min(results.length - 1, active + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(0, active - 1);
      e.preventDefault();
    } else if (e.key === 'Enter' && results[active] !== undefined) {
      choose(results[active]);
    } else if (e.key === 'Escape') {
      query = '';
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<div class="bar">
  <button class="btn ghost drawer" aria-label="Media" onclick={() => (leftOpen = !leftOpen)}>☰</button>
  <div class="brand" title={$fileName}>
    <span class="name">netview</span>
    {#if $bundle}
      <span class="faint meta num">{compact($bundle.meta.node_count)} nodes · {compact($bundle.meta.edge_count)} links ·
        {$bundle.communities.length} communities</span>
    {/if}
  </div>

  <div class="modes" role="tablist" aria-label="View mode">
    {#each MODES as m (m.id)}
      <button
        role="tab"
        aria-selected={$viewMode === m.id}
        class:active={$viewMode === m.id}
        title="{m.title} ({m.key})"
        onclick={() => viewMode.set(m.id)}>{m.label}</button>
    {/each}
  </div>

  {#if $selectedMedia.size}
    <button class="chip" title="Clear the media filter" onclick={() => setMediaSelection([])}>
      {$selectedMedia.size} media selected <span aria-hidden="true">✕</span>
    </button>
  {/if}

  <div class="search">
    <input
      id="node-search"
      class="input"
      placeholder="Search @user  ( / )"
      autocomplete="off"
      bind:value={query}
      oninput={() => (active = 0)}
      onkeydown={onSearchKey}
    />
    {#if results.length}
      <ul class="results" role="listbox">
        {#each results as node, i (node)}
          <li>
            <button class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => choose(node)}>
              @{$graph?.name(node)}
              {#if $graph && $graph.arrays.label_priority[node]}
                <span class="faint num">{compact($graph.arrays.label_priority[node])}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="actions">
    <button class="btn ghost" title="Reset view (R)" onclick={() => cameraRequest.set({ kind: 'reset' })}>⟲</button>
    <div class="pop-anchor">
      <button class="btn ghost" aria-expanded={showLegend} onclick={() => { showLegend = !showLegend; showSettings = false; }}>Legend</button>
      {#if showLegend}<div class="pop"><Legend /></div>{/if}
    </div>
    <div class="pop-anchor">
      <button class="btn ghost" aria-expanded={showSettings} title="Settings" onclick={() => { showSettings = !showSettings; showLegend = false; }}>⚙</button>
      {#if showSettings}<div class="pop"><Settings /></div>{/if}
    </div>
    <button class="btn ghost" title="Open another bundle" onclick={() => fileInput.click()}>Open…</button>
    <input bind:this={fileInput} type="file" accept=".netview,.sqlite" hidden
      onchange={() => fileInput.files?.[0] && openFile(fileInput.files[0])} />
    <button class="btn ghost drawer" aria-label="Details" onclick={() => (rightOpen = !rightOpen)}>ⓘ</button>
  </div>
</div>

<style>
  .bar {
    height: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
  }

  .brand {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    min-width: 0;
  }

  .name {
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .meta {
    font-size: 11px;
    white-space: nowrap;
  }

  .modes {
    display: flex;
    background: var(--bg-deep);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 2px;
    margin-left: 8px;
  }

  .modes button {
    border: 0;
    background: transparent;
    padding: 4px 12px;
    border-radius: 6px;
    color: var(--muted);
  }

  .modes button.active {
    background: var(--panel-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px #4a3c63;
  }

  .chip {
    border: 1px solid #5a4785;
    background: #2a2140;
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    white-space: nowrap;
  }

  .search {
    position: relative;
    margin-left: auto;
    width: 240px;
  }

  .results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    z-index: 40;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
  }

  .results button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    border: 0;
    background: transparent;
    padding: 4px 8px;
    border-radius: 5px;
    text-align: left;
  }

  .results button.active,
  .results button:hover {
    background: var(--panel-3);
  }

  .actions {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .pop-anchor {
    position: relative;
  }

  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px;
    width: 280px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
  }

  .drawer {
    display: none;
  }

  @media (max-width: 1100px) {
    .drawer {
      display: inline-block;
    }

    .meta {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .bar {
      gap: 6px;
      overflow-x: auto;
    }

    .search {
      width: 140px;
    }

    .modes button {
      padding: 4px 7px;
    }
  }
</style>
