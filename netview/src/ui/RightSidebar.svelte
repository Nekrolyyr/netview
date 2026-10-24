<script lang="ts">
  import { bundle, selectedCommunity, selectedNode } from '../state/store';
  import CommunityPanel from './CommunityPanel.svelte';
  import NodePanel from './NodePanel.svelte';
  import Overview from './Overview.svelte';
</script>

<div class="side scroll" data-testid="details">
  {#if $selectedNode !== null}
    {#key $selectedNode}<NodePanel node={$selectedNode} />{/key}
  {:else if $selectedCommunity !== null}
    {#key $selectedCommunity}<CommunityPanel community={$selectedCommunity} />{/key}
  {:else if $bundle}
    <Overview />
  {/if}
</div>

<style>
  .side {
    height: 100%;
    padding: 14px;
  }
</style>
