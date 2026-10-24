<script lang="ts">
  import type { MediaInfo } from '../data/types';
  import {
    bundle, groups, selectedMedia, setMediaSelection, toggleMedia, type MediaGroup,
  } from '../state/store';
  import { compact, formatDate, sentimentColour, signed } from './format';
  import {
    filterMedia, GROUP_COLOURS, groupsByOwner, groupsByWeek, rangeBetween, type AutoGroup, type MediaSort,
  } from './mediaGroups';
  import Thumb from './Thumb.svelte';

  const ROW = 60;

  let text = $state('');
  let kind = $state('');
  let from = $state('');
  let to = $state('');
  let sort = $state<MediaSort>('newest');
  let showGroups = $state(true);
  let autoMode = $state<'' | 'owner' | 'week'>('');
  let naming = $state(false);
  let newName = $state('');
  let editing = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);
  let anchor: string | null = null;
  let scrollTop = $state(0);
  let viewHeight = $state(600);

  const media = $derived($bundle?.media ?? []);
  const kinds = $derived([...new Set(media.map((m) => m.kind).filter(Boolean))] as string[]);
  const list = $derived(filterMedia(media, { text, kind, from, to }, sort));
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 4));
  const visible = $derived(list.slice(first, first + Math.ceil(viewHeight / ROW) + 8));
  const autoGroups = $derived<AutoGroup[]>(autoMode === 'owner' ? groupsByOwner(media)
    : autoMode === 'week' ? groupsByWeek(media) : []);

  function onRowClick(e: MouseEvent, m: MediaInfo) {
    if (e.shiftKey && anchor) {
      const range = rangeBetween(list, anchor, m.pk);
      setMediaSelection(e.ctrlKey || e.metaKey ? [...$selectedMedia, ...range] : range);
    } else if (e.ctrlKey || e.metaKey) {
      toggleMedia(m.pk);
      anchor = m.pk;
    } else {
      const only = $selectedMedia.size === 1 && $selectedMedia.has(m.pk);
      setMediaSelection(only ? [] : [m.pk]);
      anchor = m.pk;
    }
  }

  function isGroupSelected(pks: string[]): boolean {
    return pks.length > 0 && pks.length === $selectedMedia.size && pks.every((p) => $selectedMedia.has(p));
  }

  function selectGroup(e: MouseEvent, pks: string[]) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) setMediaSelection([...$selectedMedia, ...pks]);
    else setMediaSelection(isGroupSelected(pks) ? [] : pks);
  }

  function createGroup() {
    const name = newName.trim() || `Group ${$groups.length + 1}`;
    const group: MediaGroup = {
      id: `g${Date.now().toString(36)}`, name,
      colour: GROUP_COLOURS[$groups.length % GROUP_COLOURS.length], media: [...$selectedMedia],
    };
    groups.update((g) => [...g, group]);
    naming = false;
    newName = '';
  }

  function renameGroup(id: string, name: string) {
    groups.update((g) => g.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x)));
    editing = null;
  }

  function addToGroup(id: string, pks: string[]) {
    groups.update((g) => g.map((x) => (x.id === id ? { ...x, media: [...new Set([...x.media, ...pks])] } : x)));
  }

  function removeGroup(id: string) {
    groups.update((g) => g.filter((x) => x.id !== id));
  }

  function exportGroups() {
    const blob = new Blob([JSON.stringify($groups, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'netview-groups.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let importInput: HTMLInputElement;
  async function importGroups(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) return;
      const known = new Set(media.map((m) => m.pk));
      const clean: MediaGroup[] = parsed
        .filter((g) => g && typeof g.name === 'string' && Array.isArray(g.media))
        .map((g, i) => ({
          id: `g${Date.now().toString(36)}${i}`, name: g.name,
          colour: typeof g.colour === 'string' ? g.colour : GROUP_COLOURS[i % GROUP_COLOURS.length],
          media: g.media.filter((p: unknown) => typeof p === 'string' && known.has(p)),
        }));
      groups.update((g) => [...g, ...clean]);
    } catch {
      /* not a group file */
    }
  }

  function dragMedia(e: DragEvent, m: MediaInfo) {
    const pks = $selectedMedia.has(m.pk) ? [...$selectedMedia] : [m.pk];
    e.dataTransfer?.setData('application/x-netview-media', JSON.stringify(pks));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  function dropOnGroup(e: DragEvent, id: string) {
    e.preventDefault();
    dropTarget = null;
    const raw = e.dataTransfer?.getData('application/x-netview-media');
    if (raw) addToGroup(id, JSON.parse(raw));
  }
</script>

<div class="side">
  <div class="head">
    <h2 class="section-title">Media <span class="faint num">{list.length}/{media.length}</span></h2>
    <input class="input" placeholder="Filter by owner, code or caption" bind:value={text} />
    <div class="row">
      <select class="input" bind:value={kind} aria-label="Kind">
        <option value="">All kinds</option>
        {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
      </select>
      <select class="input" bind:value={sort} aria-label="Sort">
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="reach">Reach</option>
        <option value="comments">Comments</option>
        <option value="sentiment">Sentiment</option>
      </select>
    </div>
    <div class="row">
      <input class="input" type="date" bind:value={from} aria-label="From" />
      <input class="input" type="date" bind:value={to} aria-label="To" />
    </div>
  </div>

  <section class="groups">
    <div class="groups-head">
      <button class="btn ghost small toggle" onclick={() => (showGroups = !showGroups)} aria-expanded={showGroups}>
        {showGroups ? '▾' : '▸'} Groups <span class="faint">{$groups.length}</span>
      </button>
      <span class="spacer"></span>
      <button class="btn ghost small" title="Export groups as JSON" onclick={exportGroups} disabled={!$groups.length}>⤓</button>
      <button class="btn ghost small" title="Import groups from JSON" onclick={() => importInput.click()}>⤒</button>
      <input bind:this={importInput} type="file" accept="application/json,.json" hidden
        onchange={() => importInput.files?.[0] && importGroups(importInput.files[0])} />
    </div>
    {#if showGroups}
      <div class="group-list scroll">
        {#each $groups as g (g.id)}
          <div
            class="group"
            class:selected={isGroupSelected(g.media)}
            class:drop={dropTarget === g.id}
            role="listitem"
            ondragover={(e) => { e.preventDefault(); dropTarget = g.id; }}
            ondragleave={() => (dropTarget = null)}
            ondrop={(e) => dropOnGroup(e, g.id)}
          >
            <span class="dot" style="background: {g.colour}"></span>
            {#if editing === g.id}
              <input class="input rename" value={g.name} onblur={(e) => renameGroup(g.id, e.currentTarget.value)}
                onkeydown={(e) => e.key === 'Enter' && renameGroup(g.id, e.currentTarget.value)} />
            {:else}
              <button class="name" onclick={(e) => selectGroup(e, g.media)} ondblclick={() => (editing = g.id)}
                title="Click: select · Double click: rename · Drop media here to add">{g.name}</button>
            {/if}
            <span class="faint num">{g.media.length}</span>
            <button class="btn ghost small" title="Add the selected media" disabled={!$selectedMedia.size}
              onclick={() => addToGroup(g.id, [...$selectedMedia])}>＋</button>
            <button class="btn ghost small" title="Delete group" onclick={() => removeGroup(g.id)}>✕</button>
          </div>
        {/each}
        {#if naming}
          <div class="group">
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input rename" placeholder="Group name" bind:value={newName} autofocus
              onkeydown={(e) => { if (e.key === 'Enter') createGroup(); if (e.key === 'Escape') naming = false; }} />
            <button class="btn small" onclick={createGroup}>Save</button>
          </div>
        {:else}
          <button class="btn small new" disabled={!$selectedMedia.size} onclick={() => (naming = true)}>
            New group from {$selectedMedia.size} selected
          </button>
        {/if}
        <div class="auto">
          <span class="faint">Automatic:</span>
          <button class="btn ghost small" class:on={autoMode === 'owner'} onclick={() => (autoMode = autoMode === 'owner' ? '' : 'owner')}>by owner</button>
          <button class="btn ghost small" class:on={autoMode === 'week'} onclick={() => (autoMode = autoMode === 'week' ? '' : 'week')}>by week</button>
        </div>
        {#each autoGroups as g (g.id)}
          <div class="group auto-group" class:selected={isGroupSelected(g.media)}>
            <button class="name" onclick={(e) => selectGroup(e, g.media)}>{g.name}</button>
            <span class="faint num">{g.media.length}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <div class="list scroll" bind:clientHeight={viewHeight} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
    data-testid="media-list">
    <div style="height: {list.length * ROW}px; position: relative">
      {#each visible as m, i (m.pk)}
        <div
          class="item"
          class:selected={$selectedMedia.has(m.pk)}
          style="top: {(first + i) * ROW}px"
          role="option"
          aria-selected={$selectedMedia.has(m.pk)}
          tabindex="0"
          draggable="true"
          ondragstart={(e) => dragMedia(e, m)}
          onclick={(e) => onRowClick(e, m)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleMedia(m.pk))}
        >
          <input type="checkbox" checked={$selectedMedia.has(m.pk)} aria-label="Select"
            onclick={(e) => { e.stopPropagation(); toggleMedia(m.pk); anchor = m.pk; }} />
          <Thumb pk={m.pk} has={m.hasThumbnail} kind={m.kind} />
          <div class="info">
            <div class="line1"><span class="owner">@{m.owner ?? '?'}</span><span class="faint num">{formatDate(m.takenAt)}</span></div>
            <div class="line2 faint num">
              ♥ {compact(m.likes)} · 💬 {compact(m.comments)} · reach {compact(m.directCount)}+{compact(m.hopCount)}
            </div>
            {#if m.meanSentiment != null}
              <div class="sent" title="Mean comment sentiment {signed(m.meanSentiment)} ({m.nRated} rated)">
                <div class="bar" style="left: {m.meanSentiment >= 0 ? 50 : 50 + m.meanSentiment * 10}%;
                  width: {Math.abs(m.meanSentiment) * 10}%; background: {sentimentColour(m.meanSentiment)}"></div>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .side {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .head {
    padding: 12px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .groups {
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 6px 8px;
  }

  .groups-head {
    display: flex;
    align-items: center;
  }

  .toggle {
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .group-list {
    max-height: 220px;
    padding: 4px 0;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: 6px;
    border: 1px solid transparent;
  }

  .group.selected {
    background: #2a2140;
  }

  .group.drop {
    border-color: var(--accent);
  }

  .group .name {
    flex: 1;
    text-align: left;
    background: none;
    border: 0;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    flex: 1;
    padding: 2px 6px;
  }

  .new {
    margin: 4px 4px 6px;
  }

  .auto {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    font-size: 12px;
  }

  .auto .on {
    background: var(--panel-3);
  }

  .auto-group {
    padding-left: 10px;
    font-size: 12px;
  }

  .list {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .item {
    position: absolute;
    left: 0;
    right: 0;
    height: 60px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-bottom: 1px solid #241d30;
    cursor: pointer;
  }

  .item:hover {
    background: #201a2c;
  }

  .item.selected {
    background: #2a2140;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .item input {
    accent-color: var(--accent);
  }

  .info {
    min-width: 0;
    flex: 1;
  }

  .line1 {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }

  .owner {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .line2 {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sent {
    position: relative;
    height: 3px;
    margin-top: 4px;
    background: #2c2439;
    border-radius: 2px;
  }

  .sent::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -1px;
    width: 1px;
    height: 5px;
    background: var(--faint);
  }

  .bar {
    position: absolute;
    top: 0;
    height: 3px;
    border-radius: 2px;
  }
</style>
