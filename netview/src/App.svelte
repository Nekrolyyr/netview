<script lang="ts">
  import { bundle, loadError, loading, openFile, playing, selectCommunity, selectNode, viewMode, cameraRequest } from './state/store';
  import DropZone from './ui/DropZone.svelte';
  import LeftSidebar from './ui/LeftSidebar.svelte';
  import RightSidebar from './ui/RightSidebar.svelte';
  import TimeSeeker from './ui/TimeSeeker.svelte';
  import TopBar from './ui/TopBar.svelte';
  import Viewport from './ui/Viewport.svelte';

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let dragging = $state(false);

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    if (!$bundle) return;
    if (e.key === '1') viewMode.set('network');
    else if (e.key === '2') viewMode.set('community');
    else if (e.key === '3') viewMode.set('influencer');
    else if (e.key === 'r' || e.key === 'R') cameraRequest.set({ kind: 'reset' });
    else if (e.key === ' ') {
      e.preventDefault();
      playing.update((p) => !p);
    } else if (e.key === 'Escape') {
      selectNode(null);
      selectCommunity(null);
    } else if (e.key === '/') {
      e.preventDefault();
      document.querySelector<HTMLInputElement>('#node-search')?.focus();
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="app"
  class:has-bundle={!!$bundle}
  role="application"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.target === e.currentTarget) dragging = false;
  }}
  ondrop={onDrop}
>
  {#if $bundle}
    <header class="top"><TopBar bind:leftOpen bind:rightOpen /></header>
    <aside class="left" class:open={leftOpen}><LeftSidebar /></aside>
    <main class="view"><Viewport /></main>
    <aside class="right" class:open={rightOpen}><RightSidebar /></aside>
    <footer class="seek"><TimeSeeker /></footer>
  {:else}
    <DropZone />
  {/if}
  {#if dragging}
    <div class="drop-hint">Drop a <span class="mono">.netview</span> file to open it</div>
  {/if}
  {#if $loading}
    <div class="overlay"><div class="spinner"></div>{$loading}</div>
  {/if}
  {#if $loadError && $bundle}
    <div class="toast" role="alert">{$loadError}</div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    background: var(--bg-deep);
    position: relative;
  }

  .app.has-bundle {
    grid-template-columns: 300px minmax(0, 1fr) 340px;
    grid-template-rows: 52px minmax(0, 1fr) auto;
    grid-template-areas:
      'top top top'
      'left view right'
      'seek seek seek';
  }

  .top {
    grid-area: top;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    min-width: 0;
  }

  .left {
    grid-area: left;
    border-right: 1px solid var(--line);
    background: var(--panel);
    min-height: 0;
  }

  .right {
    grid-area: right;
    border-left: 1px solid var(--line);
    background: var(--panel);
    min-height: 0;
  }

  .view {
    grid-area: view;
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 45%, #1d1629 0%, var(--bg) 45%, #0b0910 100%);
  }

  .seek {
    grid-area: seek;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }

  @media (max-width: 1100px) {
    .app.has-bundle {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'top'
        'view'
        'seek';
    }

    .left,
    .right {
      position: absolute;
      top: 52px;
      bottom: 0;
      width: min(340px, 88vw);
      z-index: 20;
      display: none;
      box-shadow: 0 10px 40px rgb(0 0 0 / 0.5);
    }

    .left {
      left: 0;
    }

    .right {
      right: 0;
    }

    .left.open,
    .right.open {
      display: block;
    }
  }

  .drop-hint {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--accent);
    border-radius: 14px;
    display: grid;
    place-items: center;
    font-size: 16px;
    background: rgb(20 16 28 / 0.75);
    pointer-events: none;
    z-index: 50;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    background: rgb(13 10 19 / 0.7);
    z-index: 60;
    font-size: 14px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 120px;
    transform: translateX(-50%);
    background: #3a1620;
    border: 1px solid #6b2433;
    padding: 8px 14px;
    border-radius: 8px;
    z-index: 70;
  }
</style>
