<script lang="ts">
  import { bundle, selectedMedia, setMediaSelection, viewedMedia } from '../state/store';
  import { compact, formatDate, sentimentColour, signed } from './format';
  import { mediaUrl } from './mediaFiles';

  const medium = $derived($bundle?.media.find((m) => m.pk === $viewedMedia) ?? null);
  const files = $derived(medium?.files ?? []);
  let index = $state(0);
  let failed = $state(false);
  let video = $state<HTMLVideoElement | null>(null);
  let audio = $state<HTMLAudioElement | null>(null);
  const file = $derived(files[Math.min(index, files.length - 1)] ?? null);

  $effect(() => {
    void $viewedMedia;
    index = 0;
  });

  $effect(() => {
    void file;
    failed = false;
  });

  function step(delta: number) {
    if (files.length > 1) index = (index + delta + files.length) % files.length;
  }

  function close() {
    viewedMedia.set(null);
  }

  /** Capture phase: the viewer owns Esc and the arrow keys while it is open. */
  function onKey(e: KeyboardEvent) {
    if (!medium) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** A video exported without ffmpeg has its sound in a second file: keep the two in step. */
  function sync(e: Event) {
    if (!audio || !video) return;
    if (e.type === 'play') audio.play().catch(() => {});
    else if (e.type === 'pause') audio.pause();
    else if (e.type === 'ratechange') audio.playbackRate = video.playbackRate;
    if (Math.abs(audio.currentTime - video.currentTime) > 0.3) audio.currentTime = video.currentTime;
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if medium}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Media" data-testid="media-viewer">
      <div class="stage">
        {#if !file}
          <p class="faint">No downloaded file for this post.</p>
        {:else if failed}
          <p class="faint">The file <span class="mono">{file.file}</span> is not available on this server.</p>
        {:else if file.kind === 'video'}
          {#key file.file}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} src={mediaUrl(file.file)} controls autoplay playsinline muted={!!file.audio}
              onerror={() => (failed = true)} onplay={sync} onpause={sync} onseeked={sync} onratechange={sync}></video>
            {#if file.audio}<audio bind:this={audio} src={mediaUrl(file.audio)} preload="auto"></audio>{/if}
          {/key}
        {:else}
          {#key file.file}
            <img src={mediaUrl(file.file)} alt={medium.caption ?? ''} onerror={() => (failed = true)} />
          {/key}
        {/if}
        {#if files.length > 1}
          <button class="nav prev" title="Previous (←)" onclick={() => step(-1)}>‹</button>
          <button class="nav next" title="Next (→)" onclick={() => step(1)}>›</button>
          <div class="dots">
            {#each files as f, i (f.file)}
              <button class="pip" class:on={i === index} aria-label="Item {i + 1}" onclick={() => (index = i)}></button>
            {/each}
          </div>
        {/if}
      </div>
      <aside class="info">
        <div class="head">
          <h2>@{medium.owner ?? '?'}</h2>
          <button class="btn ghost small" title="Close (Esc)" onclick={close}>✕</button>
        </div>
        <div class="faint num">
          {formatDate(medium.takenAt, true)}{files.length > 1 ? ` · ${index + 1}/${files.length}` : ''}
        </div>
        <div class="num stats">
          ♥ {compact(medium.likes)} · 💬 {compact(medium.comments)} · reach {compact(medium.directCount)}+{compact(medium.hopCount)}
        </div>
        {#if medium.meanSentiment != null}
          <div class="num" style="color: {sentimentColour(medium.meanSentiment)}">
            Mean sentiment {signed(medium.meanSentiment)} <span class="faint">({medium.nRated} rated)</span>
          </div>
        {/if}
        {#if medium.caption}<p class="caption scroll">{medium.caption}</p>{/if}
        <div class="actions">
          <button class="btn small" onclick={() => setMediaSelection([medium.pk])}
            disabled={$selectedMedia.size === 1 && $selectedMedia.has(medium.pk)}>Show reach</button>
          {#if medium.code}
            <a class="btn small" href="https://www.instagram.com/p/{medium.code}/" target="_blank"
              rel="noreferrer noopener">Open on Instagram</a>
          {/if}
        </div>
      </aside>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(8 6 12 / 0.82);
  }

  .viewer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    width: min(1200px, 100%);
    height: min(820px, 100%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    background: #000;
  }

  .stage img,
  .stage video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .stage p {
    padding: 24px;
    text-align: center;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    background: rgb(20 16 28 / 0.7);
    color: var(--text);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .nav:hover {
    background: rgb(43 34 57 / 0.9);
  }

  .prev {
    left: 10px;
  }

  .next {
    right: 10px;
  }

  .dots {
    position: absolute;
    bottom: 10px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 5px;
  }

  .pip {
    width: 7px;
    height: 7px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.35);
    cursor: pointer;
  }

  .pip.on {
    background: #fff;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-left: 1px solid var(--line);
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stats {
    font-size: 12px;
  }

  .caption {
    flex: 1;
    min-height: 0;
    margin: 6px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--muted);
  }

  .actions {
    display: flex;
    gap: 6px;
    margin-top: auto;
  }

  .actions a {
    text-decoration: none;
  }

  @media (max-width: 800px) {
    .backdrop {
      padding: 0;
    }

    .viewer {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      height: 100%;
      border-radius: 0;
    }

    .info {
      border-left: 0;
      border-top: 1px solid var(--line);
      max-height: 40vh;
    }
  }
</style>
