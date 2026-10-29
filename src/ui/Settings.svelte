<script lang="ts">
  import { EDGE_BIT, EDGE_TYPES } from '../data/types';
  import { DEFAULT_SETTINGS, edgeTypes, settings } from '../state/store';
  import { EDGE_LABELS } from './format';

  function update<K extends keyof typeof DEFAULT_SETTINGS>(key: K, value: (typeof DEFAULT_SETTINGS)[K]) {
    settings.update((s) => ({ ...s, [key]: value }));
  }
</script>

<div class="settings">
  <h3 class="section-title">Display</h3>
  <label>Node size <span class="num faint">{$settings.nodeScale.toFixed(1)}×</span>
    <input type="range" min="0.3" max="3" step="0.1" value={$settings.nodeScale}
      oninput={(e) => update('nodeScale', +e.currentTarget.value)} /></label>
  <label>Cloud intensity <span class="num faint">{$settings.cloudOpacity.toFixed(1)}×</span>
    <input type="range" min="0" max="3" step="0.1" value={$settings.cloudOpacity}
      oninput={(e) => update('cloudOpacity', +e.currentTarget.value)} /></label>
  <label>Link intensity <span class="num faint">{$settings.edgeOpacity.toFixed(1)}×</span>
    <input type="range" min="0" max="4" step="0.1" value={$settings.edgeOpacity}
      oninput={(e) => update('edgeOpacity', +e.currentTarget.value)} /></label>
  <label>Max. labels <span class="num faint">{$settings.maxLabels}</span>
    <input type="range" min="0" max="200" step="5" value={$settings.maxLabels}
      oninput={(e) => update('maxLabels', +e.currentTarget.value)} /></label>
  <label class="check"><input type="checkbox" checked={$settings.autoRotate}
      onchange={(e) => update('autoRotate', e.currentTarget.checked)} /> Auto-rotate</label>
  <label class="check"><input type="checkbox" checked={$settings.influencerEdges}
      onchange={(e) => update('influencerEdges', e.currentTarget.checked)} /> Links in the influencer view</label>
  <label class="check"><input type="checkbox" checked={$settings.communityLabels}
      onchange={(e) => update('communityLabels', e.currentTarget.checked)} /> Community labels</label>
  <label class="check" title="Zoomed out, ordinary accounts recede and links fade; zoom in for the details">
    <input type="checkbox" checked={$settings.lod}
      onchange={(e) => update('lod', e.currentTarget.checked)} /> Level of detail by zoom</label>

  <h3 class="section-title types">Link types</h3>
  <div class="grid">
    {#each EDGE_TYPES as t (t)}
      <label class="check"><input type="checkbox" checked={($edgeTypes & EDGE_BIT[t]) !== 0}
          onchange={(e) => edgeTypes.update((m) => (e.currentTarget.checked ? m | EDGE_BIT[t] : m & ~EDGE_BIT[t]))} />
        {EDGE_LABELS[t]}</label>
    {/each}
  </div>
  <button class="btn small reset" onclick={() => { settings.set({ ...DEFAULT_SETTINGS }); edgeTypes.set(0xff); }}>Reset</button>
</div>

<style>
  .settings {
    font-size: 12px;
  }

  label {
    display: block;
    margin-bottom: 8px;
  }

  label input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .check input {
    accent-color: var(--accent);
  }

  .types {
    margin-top: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .reset {
    margin-top: 8px;
  }
</style>
