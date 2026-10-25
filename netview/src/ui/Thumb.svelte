<script lang="ts">
  import { client } from '../state/store';
  import { mediaUrl } from './mediaFiles';

  /** ``image``: a downloaded image file, used when the bundle has no thumbnail. */
  let { pk, has, kind, image = null }: { pk: string; has: boolean; kind: string | null; image?: string | null } =
    $props();
  let url = $state<string | null>(null);

  $effect(() => {
    url = null;
    if (!has) {
      if (image) url = mediaUrl(image);
      return;
    }
    let alive = true;
    client.thumbnail(pk).then((u) => {
      if (alive) url = u;
    });
    return () => {
      alive = false;
    };
  });
</script>

<div class="thumb">
  {#if url}
    <img src={url} alt="" loading="lazy" onerror={() => (url = null)} />
  {:else}
    <span class="kind">{kind === 'reel' ? '▶' : kind === 'carousel' ? '❐' : '◻'}</span>
  {/if}
</div>

<style>
  .thumb {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--panel-3);
    display: grid;
    place-items: center;
    flex: none;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .kind {
    color: var(--faint);
    font-size: 16px;
  }
</style>
