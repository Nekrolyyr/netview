<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';

  import { countActive, effectiveTimes } from '../filters/time';
  import { bundle, playing, playSpeed, reach, seekerTime } from '../state/store';
  import { compact, formatRel } from './format';

  const DAY = 86400;
  const PLAY_SECONDS = 40;

  let canvas: HTMLCanvasElement;
  let track: HTMLDivElement;
  let width = $state(600);
  let height = $state(56);
  let hoverT = $state<number | null>(null);
  let dragging = false;

  const meta = $derived($bundle!.meta);
  const span = $derived(Math.max(1, meta.t_max - meta.t_min));

  /** Bars per day: (exact, derived) – or the reach of the media selection. */
  const bars = $derived.by(() => {
    const days = Math.ceil(span / DAY) + 1;
    const exact = new Float64Array(days);
    const derived = new Float64Array(days);
    const r = $reach;
    if (r) {
      for (let i = 0; i < r.time.length; i++) {
        if (!Number.isFinite(r.time[i])) continue;
        const d = Math.floor((r.time[i] - meta.t_min) / DAY);
        if (d >= 0 && d < days) (r.level[i] === 1 ? exact : derived)[d]++;
      }
    } else {
      for (const row of $bundle!.timeline) {
        const t = Date.parse(`${row.day}T00:00:00Z`) / 1000 - meta.t0;
        const d = Math.floor((t - meta.t_min) / DAY);
        if (d >= 0 && d < days) {
          exact[d] += row.exact;
          derived[d] += row.derived;
        }
      }
    }
    let max = 1;
    for (let d = 0; d < days; d++) max = Math.max(max, exact[d] + derived[d]);
    return { days, exact, derived, max };
  });

  const tEff = $derived($bundle ? effectiveTimes($bundle.arrays.t_act, meta.t_max, $reach) : new Float32Array(0));
  const activeCount = $derived(countActive(tEff, $seekerTime));

  function x(t: number) {
    return ((t - meta.t_min) / span) * width;
  }

  function tAt(px: number) {
    return Math.min(meta.t_max, Math.max(meta.t_min, meta.t_min + (px / width) * span));
  }

  $effect(() => {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { days, exact, derived, max } = bars;
    const bw = Math.max(1, width / days);
    const cut = x($seekerTime);
    // sqrt scale: a few busy days should not flatten everything else
    const scale = (v: number) => (Math.sqrt(v) / Math.sqrt(max)) * (height - 4);
    for (let d = 0; d < days; d++) {
      const bx = (d / days) * width;
      const he = scale(exact[d] + derived[d]);
      const hx = scale(exact[d]);
      const past = bx + bw / 2 <= cut;
      ctx.fillStyle = past ? '#6b5a99' : '#3a3150';
      ctx.fillRect(bx, height - he, Math.max(1, bw - 0.5), he - hx);
      ctx.fillStyle = past ? '#c9b8ff' : '#5a4d78';
      ctx.fillRect(bx, height - hx, Math.max(1, bw - 0.5), hx);
    }
    ctx.fillStyle = 'rgba(13,10,19,0.35)';
    ctx.fillRect(cut, 0, width - cut, height);
    ctx.fillStyle = '#ece8f3';
    ctx.fillRect(Math.round(cut) - 1, 0, 2, height);
    if (hoverT !== null) {
      ctx.fillStyle = 'rgba(236,232,243,0.35)';
      ctx.fillRect(Math.round(x(hoverT)), 0, 1, height);
    }
  });

  function seekFromEvent(e: PointerEvent) {
    const rect = track.getBoundingClientRect();
    seekerTime.set(tAt(e.clientX - rect.left));
  }

  function onDown(e: PointerEvent) {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    playing.set(false);
    seekFromEvent(e);
  }

  function onMove(e: PointerEvent) {
    const rect = track.getBoundingClientRect();
    hoverT = tAt(e.clientX - rect.left);
    if (dragging) seekFromEvent(e);
  }

  function onKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 7 * DAY : DAY;
    if (e.key === 'ArrowLeft') seekerTime.update((t) => Math.max(meta.t_min, t - step));
    else if (e.key === 'ArrowRight') seekerTime.update((t) => Math.min(meta.t_max, t + step));
    else if (e.key === 'Home') seekerTime.set(meta.t_min);
    else if (e.key === 'End') seekerTime.set(meta.t_max);
    else return;
    e.preventDefault();
  }

  // ------------------------------------------------------------ playback
  let raf = 0;
  let last = 0;
  function tick(now: number) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    let done = false;
    seekerTime.update((t) => {
      const next = t + (span / PLAY_SECONDS) * get(playSpeed) * dt;
      if (next >= meta.t_max) {
        done = true;
        return meta.t_max;
      }
      return next;
    });
    if (done) playing.set(false);
    else raf = requestAnimationFrame(tick);
  }

  $effect(() => {
    if ($playing) {
      // read without subscribing: the effect must only restart when play is toggled
      if (get(seekerTime) >= meta.t_max) seekerTime.set(meta.t_min);
      last = 0;
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  });

  onDestroy(() => cancelAnimationFrame(raf));
</script>

<div class="seeker">
  <div class="controls">
    <button class="btn play" aria-label={$playing ? 'Pause' : 'Play'} title="Play / pause (Space)"
      onclick={() => playing.update((p) => !p)}>{$playing ? '❚❚' : '▶'}</button>
    <button class="btn ghost small" title="Start" onclick={() => seekerTime.set(meta.t_min)}>⏮</button>
    <button class="btn ghost small" title="One day back" onclick={() => seekerTime.update((t) => Math.max(meta.t_min, t - DAY))}>‹</button>
    <button class="btn ghost small" title="One day forward" onclick={() => seekerTime.update((t) => Math.min(meta.t_max, t + DAY))}>›</button>
    <button class="btn ghost small" title="End: everything active" onclick={() => seekerTime.set(meta.t_max)}>⏭</button>
    <select class="input speed" bind:value={$playSpeed} aria-label="Speed">
      <option value={0.25}>0.25×</option>
      <option value={0.5}>0.5×</option>
      <option value={1}>1×</option>
      <option value={2}>2×</option>
      <option value={4}>4×</option>
    </select>
  </div>
  <div class="main">
    <div class="labels">
      <span class="date num" data-testid="seeker-date">{formatRel(meta.t0, $seekerTime, true)}</span>
      <span class="faint num">{compact(activeCount)} of {compact(meta.node_count)} nodes {$reach ? 'reached' : 'active'}</span>
      <span class="legend faint"><i class="sw a"></i>{$reach ? 'direct' : 'exact'} <i class="sw b"></i>{$reach ? 'one hop' : 'one hop derived'}</span>
    </div>
    <div
      class="track"
      bind:this={track}
      bind:clientWidth={width}
      role="slider"
      tabindex="0"
      aria-label="Time"
      aria-valuemin={meta.t_min}
      aria-valuemax={meta.t_max}
      aria-valuenow={$seekerTime}
      aria-valuetext={formatRel(meta.t0, $seekerTime)}
      data-testid="seeker"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={() => (dragging = false)}
      onpointerleave={() => (hoverT = null)}
      onkeydown={onKey}
    >
      <canvas bind:this={canvas} style="width: {width}px; height: {height}px"></canvas>
      {#if hoverT !== null}
        <span class="hover num" style="left: {Math.min(width - 90, Math.max(0, x(hoverT) - 45))}px">{formatRel(meta.t0, hoverT)}</span>
      {/if}
    </div>
    <div class="axis faint num">
      <span>{formatRel(meta.t0, meta.t_min)}</span>
      <span>{formatRel(meta.t0, meta.t_min + span / 2)}</span>
      <span>{formatRel(meta.t0, meta.t_max)}</span>
    </div>
  </div>
</div>

<style>
  .seeker {
    display: flex;
    gap: 14px;
    padding: 8px 14px 6px;
    align-items: center;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .play {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    padding: 0;
    margin-right: 6px;
    background: #3b2d58;
    border-color: #5a4785;
  }

  .speed {
    width: 64px;
    margin-left: 6px;
    padding: 3px 4px;
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  .labels {
    display: flex;
    gap: 14px;
    align-items: baseline;
    font-size: 12px;
    margin-bottom: 2px;
  }

  .date {
    font-weight: 600;
  }

  .legend {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sw {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    margin-left: 6px;
  }

  .sw.a {
    background: #c9b8ff;
  }

  .sw.b {
    background: #6b5a99;
  }

  .track {
    position: relative;
    height: 56px;
    cursor: ew-resize;
    touch-action: none;
    border-radius: 4px;
    background: var(--bg-deep);
  }

  canvas {
    display: block;
  }

  .hover {
    position: absolute;
    top: -2px;
    width: 90px;
    text-align: center;
    font-size: 10px;
    color: var(--text);
    pointer-events: none;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    margin-top: 2px;
  }

  @media (max-width: 760px) {
    .seeker {
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
    }

    .legend {
      display: none;
    }
  }
</style>
