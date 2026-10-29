<script lang="ts">
  import { bundle } from '../state/store';
  import { compact } from './format';
</script>

<div class="legend">
  <h3 class="section-title">Accounts</h3>
  <div class="row"><span class="dot fill"></span>Fill = community colour (white: in no community)</div>
  <div class="row"><span class="dot ring" style="border-color: var(--whitelist)"></span>Source accounts (whitelist): red ring</div>
  <div class="row"><span class="dot ring" style="border-color: var(--influencer)"></span>Influencer
    (&gt; {compact($bundle?.meta.influencer_min ?? 10000)} followers): pink ring</div>
  <div class="row"><span class="dot" style="background: #5b5566"></span>Not active yet / not reached</div>
  <p class="faint note">Node size grows with the accounts absorbed into it (users with only this one link). The six
    largest communities have their own colour, smaller ones are grey.</p>

  <h3 class="section-title">Ordered views</h3>
  <p class="faint note">
    <b>Sentiment</b>: communities along the axis by their mean sentiment towards the GSF, unrated ones on the right.
    <b>Radial</b>: source accounts in the middle; the larger the share of a community's members with a direct link to
    a source account, the closer it is. <b>Ring</b>: communities clockwise by size from the top. Accounts in no community
    sit between the communities they are linked to. <b>Sphere</b>: every account on a ball that hides what lies behind
    it; communities are outlined coloured areas that may overlap, links run along the surface.
  </p>

  <h3 class="section-title">Community view</h3>
  <div class="row"><span class="cloud"></span>Community cloud (colour per community)</div>
  <div class="row"><span class="arrow" style="background: var(--positive)"></span>Supportive comments A → B</div>
  <div class="row"><span class="arrow" style="background: var(--negative)"></span>Hostile comments A → B</div>
  <p class="faint note">Arrow width = |mean sentiment|, opacity = number of comments. Sentiment is the
    rated attitude towards the GSF{#if $bundle?.meta.stance_prompt}; replies use their agreement with the parent comment{/if}.</p>

  <h3 class="section-title">Keys</h3>
  <p class="faint note keys">
    <span class="mono">1–7</span> view · <span class="mono">Space</span> play · <span class="mono">R</span> reset ·
    <span class="mono">/</span> search · <span class="mono">Esc</span> clear selection · click a cloud: focus the community · double click: fly to
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

  .dot.fill {
    background: conic-gradient(#199e70 0 33%, #902cab 0 66%, #2b83fd 0);
  }

  .dot.ring {
    background: var(--other);
    border: 2px solid;
    box-sizing: border-box;
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
