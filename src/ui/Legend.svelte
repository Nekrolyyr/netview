<script lang="ts">
  import { bundle } from '../state/store';
  import { compact } from './format';
</script>

<div class="legend">
  <h3 class="section-title">Accounts</h3>
  <div class="row"><span class="dot" style="background: var(--whitelist)"></span>Source accounts (whitelist)</div>
  <div class="row"><span class="dot" style="background: var(--influencer)"></span>Influencer
    (&gt; {compact($bundle?.meta.influencer_min ?? 10000)} followers)</div>
  <div class="row"><span class="dot" style="background: var(--other)"></span>Other accounts</div>
  <div class="row"><span class="dot" style="background: #5b5566"></span>Not active yet / not reached</div>
  <p class="faint note">Node size grows with the accounts absorbed into it (users with only this one link).</p>

  <h3 class="section-title">Community view</h3>
  <div class="row"><span class="cloud"></span>Community cloud (colour per community)</div>
  <div class="row"><span class="arrow" style="background: var(--positive)"></span>Supportive comments A → B</div>
  <div class="row"><span class="arrow" style="background: var(--negative)"></span>Hostile comments A → B</div>
  <p class="faint note">Arrow width = |mean sentiment|, opacity = number of comments. Sentiment is the
    rated attitude towards the GSF{#if $bundle?.meta.stance_prompt}; replies use their agreement with the parent comment{/if}.</p>

  <h3 class="section-title">Keys</h3>
  <p class="faint note keys">
    <span class="mono">1 2 3</span> view · <span class="mono">Space</span> play · <span class="mono">R</span> reset ·
    <span class="mono">/</span> search · <span class="mono">Esc</span> clear selection · double click: fly to
  </p>
</div>

<style>
  .legend {
    font-size: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .note {
    margin: 4px 0 12px;
    font-size: 11px;
  }

  .cloud {
    width: 18px;
    height: 12px;
    border-radius: 50%;
    background: radial-gradient(circle, #4bddbaaa, transparent 70%);
  }

  .arrow {
    width: 18px;
    height: 3px;
    border-radius: 2px;
  }

  .keys {
    margin-bottom: 0;
  }
</style>
