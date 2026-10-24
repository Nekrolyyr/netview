<script lang="ts">
  import { loadError, openFile } from '../state/store';

  let input: HTMLInputElement;
</script>

<div class="drop">
  <div class="card">
    <div class="logo" aria-hidden="true">
      <span class="dot" style="background: var(--whitelist)"></span>
      <span class="dot" style="background: var(--influencer)"></span>
      <span class="dot" style="background: var(--other)"></span>
    </div>
    <h1>netview</h1>
    <p class="muted">
      Open a network bundle exported with
      <span class="mono">har-analyzer export --format viewer</span>.
      The file stays on this computer; nothing is uploaded.
    </p>
    <button class="btn primary" onclick={() => input.click()}>Open .netview file</button>
    <p class="faint hint">…or drop it anywhere on this page.</p>
    <input
      bind:this={input}
      type="file"
      accept=".netview,.sqlite,application/x-sqlite3"
      hidden
      data-testid="bundle-input"
      onchange={() => input.files?.[0] && openFile(input.files[0])}
    />
    {#if $loadError}
      <p class="error" role="alert">{$loadError}</p>
    {/if}
  </div>
</div>

<style>
  .drop {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    background: radial-gradient(ellipse at 50% 40%, #241b33 0%, var(--bg) 50%, #0b0910 100%);
  }

  .card {
    max-width: 440px;
    text-align: center;
  }

  .logo {
    display: flex;
    gap: 6px;
    justify-content: center;
    margin-bottom: 10px;
  }

  .logo .dot {
    width: 14px;
    height: 14px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .primary {
    margin-top: 12px;
    padding: 8px 18px;
    background: #3b2d58;
    border-color: #5a4785;
    font-weight: 600;
  }

  .primary:hover {
    background: #47366b;
  }

  .hint {
    font-size: 12px;
  }

  .error {
    color: #ff9aa8;
  }
</style>
