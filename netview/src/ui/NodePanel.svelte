<script lang="ts">
  import { EDGE_BIT, EDGE_TYPES, FLAG, T_KIND, UNCLUSTERED, type EdgeType } from '../data/types';
  import {
    bundle, cameraRequest, client, graph, reach, selectCommunity, selectNode, seekerTime,
  } from '../state/store';
  import { compact, EDGE_LABELS, formatDate, formatRel, sentimentColour, signed } from './format';

  let { node }: { node: number } = $props();

  interface NodeRow {
    user_id: string; username: string | null; full_name: string | null; biography: string | null;
    is_verified: number | null; is_private: number | null; follower_count: number | null;
    following_count: number | null; media_count: number | null; profile_fetched: number | null;
    community_id: number | null; absorbed_count: number; degree: number; t_act: number | null; t_kind: number;
    sentiment_mean: number | null; sentiment_n: number | null;
  }
  interface CommentRow { comment_pk: string; created_at: number | null; text: string | null; sentiment: number | null;
    relevance: number | null; parent_comment_pk: string | null; code: string | null; owner_username: string | null }
  interface AbsorbedRow { username: string | null; link_types: number; direction: number; t_act: number | null }

  let info = $state<NodeRow | null>(null);
  let comments = $state<CommentRow[]>([]);
  let absorbed = $state<AbsorbedRow[]>([]);
  let media = $state<{ pk: string; level: 1 | 2; t: number }[]>([]);
  let showAbsorbed = $state(false);
  let neighbourType = $state<EdgeType | ''>('');

  $effect(() => {
    const n = node;
    client.query<NodeRow & Record<string, unknown>>('SELECT * FROM nodes WHERE idx = ?', [n]).then(([row]) => {
      info = row ?? null;
      if (!row) return;
      client.query<CommentRow & Record<string, unknown>>(
        `SELECT c.comment_pk, c.created_at, c.text, c.sentiment, c.relevance, c.parent_comment_pk, m.code, m.owner_username
           FROM comments c LEFT JOIN media m USING (media_pk)
          WHERE c.user_idx = ? AND c.user_id = ? ORDER BY c.created_at DESC LIMIT 100`, [n, row.user_id])
        .then((r) => (comments = r));
    });
    client.query<AbsorbedRow & Record<string, unknown>>(
      'SELECT username, link_types, direction, t_act FROM absorbed WHERE host_idx = ? ORDER BY t_act IS NULL, t_act LIMIT 300',
      [n]).then((r) => (absorbed = r));
    client.mediaOf(n).then((r) => (media = r));
  });

  const g = $derived($graph!);
  const meta = $derived($bundle!.meta);
  const flags = $derived(g.arrays.flags[node]);
  const community = $derived(g.arrays.community[node] === UNCLUSTERED ? null : $bundle!.communities[g.arrays.community[node]]);
  const neighbours = $derived.by(() => {
    const { edge_types, label_priority } = g.arrays;
    const list = g.neighbours(node).map(({ node: j, edge }) => ({ node: j, types: edge_types[edge] }));
    const counts = Object.fromEntries(EDGE_TYPES.map((t) => [t, list.filter((x) => x.types & EDGE_BIT[t]).length]));
    const filtered = neighbourType ? list.filter((x) => x.types & EDGE_BIT[neighbourType as EdgeType]) : list;
    filtered.sort((a, b) => label_priority[b.node] - label_priority[a.node]);
    return { total: list.length, counts, top: filtered.slice(0, 60) };
  });
  const mediaByPk = $derived(new Map(($bundle?.media ?? []).map((m) => [m.pk, m])));
  const reachLevel = $derived($reach ? $reach.level[node] : null);
  const active = $derived(($reach ? $reach.time[node] : Number.isFinite(g.arrays.t_act[node]) ? g.arrays.t_act[node] : meta.t_max) <= $seekerTime);

  function typesOf(mask: number): string {
    return EDGE_TYPES.filter((t) => mask & EDGE_BIT[t]).map((t) => EDGE_LABELS[t]).join(', ');
  }
</script>

{#if info}
  <div class="head">
    <span class="dot big" style="background: {flags & FLAG.whitelist ? 'var(--whitelist)' : flags & FLAG.influencer ? 'var(--influencer)' : 'var(--other)'}"></span>
    <div class="who">
      <h2>
        {#if info.username && !meta.pseudonymized}
          <a href="https://www.instagram.com/{info.username}/" target="_blank" rel="noreferrer noopener">@{info.username}</a>
        {:else}@{info.username ?? '?'}{/if}
        {#if info.is_verified}<span class="badge" title="verified">✓</span>{/if}
        {#if info.is_private}<span class="badge" title="private">🔒</span>{/if}
      </h2>
      {#if info.full_name}<div class="muted">{info.full_name}</div>{/if}
    </div>
    <button class="btn ghost small" title="Fly to" onclick={() => cameraRequest.set({ kind: 'node', node })}>◎</button>
    <button class="btn ghost small" title="Close" onclick={() => selectNode(null)}>✕</button>
  </div>
  <div class="roles">
    {#if flags & FLAG.whitelist}<span class="role source">Source account</span>{/if}
    {#if flags & FLAG.influencer}<span class="role influencer">Influencer</span>{/if}
    <span class="role" class:inactive={!active}>{active ? 'active' : 'not active yet'}</span>
    {#if reachLevel !== null}
      <span class="role">{reachLevel === 1 ? 'reached directly' : reachLevel === 2 ? 'reached one hop' : 'not reached'}</span>
    {/if}
  </div>
  {#if info.biography}<p class="bio">{info.biography}</p>{/if}

  <dl class="facts">
    <dt>Followers</dt><dd class="num">{info.profile_fetched ? compact(info.follower_count) : 'unknown'}</dd>
    <dt>Following</dt><dd class="num">{info.profile_fetched ? compact(info.following_count) : 'unknown'}</dd>
    <dt>Posts</dt><dd class="num">{info.profile_fetched ? compact(info.media_count) : 'unknown'}</dd>
    <dt>Links</dt><dd class="num">{neighbours.total} visible · {compact(info.degree)} total</dd>
    <dt>Absorbed</dt><dd class="num">{compact(info.absorbed_count)}</dd>
    <dt>Activated</dt><dd class="num">{info.t_act == null ? 'no time' : formatDate(info.t_act, true)}
      <span class="faint">({info.t_kind === T_KIND.exact ? 'exact' : info.t_kind === T_KIND.derived ? 'one hop' : 'none'})</span></dd>
    {#if $reach && reachLevel}
      <dt>Reached</dt><dd class="num">{formatRel(meta.t0, $reach.time[node], true)}</dd>
    {/if}
    <dt>Sentiment</dt><dd class="num" style="color: {sentimentColour(info.sentiment_mean)}">{signed(info.sentiment_mean)}
      {#if info.sentiment_n}<span class="faint">({info.sentiment_n} comments)</span>{/if}</dd>
    <dt>Community</dt>
    <dd>
      {#if community}
        <button class="link" onclick={() => selectCommunity(community.id)}>
          <span class="dot" style="background: {community.colour}"></span> {community.label}</button>
      {:else}<span class="faint">none</span>{/if}
    </dd>
  </dl>

  <section>
    <h3 class="section-title">Neighbours</h3>
    <div class="types">
      <button class="chip" class:on={!neighbourType} onclick={() => (neighbourType = '')}>all {neighbours.total}</button>
      {#each EDGE_TYPES as t (t)}
        {#if neighbours.counts[t]}
          <button class="chip" class:on={neighbourType === t} onclick={() => (neighbourType = t)}>{EDGE_LABELS[t]} {neighbours.counts[t]}</button>
        {/if}
      {/each}
    </div>
    <ul class="list">
      {#each neighbours.top as nb (nb.node)}
        <li>
          <button onclick={() => selectNode(nb.node)} title={typesOf(nb.types)}>
            <span class="dot" style="background: {g.arrays.flags[nb.node] & FLAG.whitelist ? 'var(--whitelist)' : g.arrays.flags[nb.node] & FLAG.influencer ? 'var(--influencer)' : 'var(--other)'}"></span>
            <span class="nm">@{g.name(nb.node)}</span>
            <span class="faint num">{compact(g.arrays.label_priority[nb.node] || null)}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  {#if absorbed.length}
    <section>
      <h3 class="section-title">
        <button class="link" onclick={() => (showAbsorbed = !showAbsorbed)}>{showAbsorbed ? '▾' : '▸'} Absorbed accounts ({compact(info.absorbed_count)})</button>
      </h3>
      {#if showAbsorbed}
        <ul class="list compact">
          {#each absorbed as a, i (i)}
            <li><span class="nm">@{a.username ?? '?'}</span>
              <span class="faint">{typesOf(a.link_types)} {a.direction === 1 ? '→' : a.direction === 2 ? '←' : '↔'}</span>
              <span class="faint num">{a.t_act ? formatDate(a.t_act) : ''}</span></li>
          {/each}
          {#if info.absorbed_count > absorbed.length}<li class="faint">… and {compact(info.absorbed_count - absorbed.length)} more</li>{/if}
        </ul>
      {/if}
    </section>
  {/if}

  {#if comments.length}
    <section>
      <h3 class="section-title">Comments ({comments.length}{comments.length === 100 ? '+' : ''})</h3>
      {#each comments as c (c.comment_pk)}
        <div class="comment">
          <div class="cmeta faint">
            <span class="num">{formatDate(c.created_at)}</span>
            {#if c.code}on <a href="https://www.instagram.com/p/{c.code}/" target="_blank" rel="noreferrer noopener">@{c.owner_username}/{c.code}</a>{/if}
            {#if c.parent_comment_pk}<span>(reply)</span>{/if}
            <span class="score num" style="color: {sentimentColour(c.sentiment)}" title="sentiment">{signed(c.sentiment, 1)}</span>
          </div>
          {#if c.text}<div class="ctext">{c.text}</div>{:else}<div class="faint">(text not exported)</div>{/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if media.length}
    <section>
      <h3 class="section-title">Reached by {media.length} media</h3>
      <ul class="list compact">
        {#each media.slice(0, 80) as m (m.pk)}
          {@const mi = mediaByPk.get(m.pk)}
          <li>
            <span class="nm">@{mi?.owner ?? '?'}</span>
            <span class="faint num">{formatDate(mi?.takenAt)}</span>
            <span class="faint">{m.level === 1 ? 'interacted' : 'one hop'}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{:else}
  <p class="faint">Loading …</p>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .dot.big {
    width: 14px;
    height: 14px;
    margin-top: 5px;
  }

  .who {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  h2 a {
    color: var(--text);
    text-decoration: none;
  }

  h2 a:hover {
    text-decoration: underline;
  }

  .badge {
    font-size: 12px;
    margin-left: 4px;
  }

  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 8px 0;
  }

  .role {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--panel-3);
    color: var(--muted);
  }

  .role.source {
    background: #4a1820;
    color: #ff9a9a;
  }

  .role.influencer {
    background: #4a1a3d;
    color: #ffb3e6;
  }

  .role.inactive {
    color: var(--faint);
  }

  .bio {
    white-space: pre-line;
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 10px;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0 0 14px;
    font-size: 12px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    text-align: right;
    min-width: 0;
  }

  section {
    margin-bottom: 14px;
  }

  .link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
  }

  .link:hover {
    color: var(--text);
  }

  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .chip {
    font-size: 11px;
    border: 1px solid var(--line);
    background: transparent;
    border-radius: 999px;
    padding: 0 8px;
    color: var(--muted);
  }

  .chip.on {
    background: var(--panel-3);
    color: var(--text);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12px;
  }

  .list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: 0;
    padding: 2px 4px;
    border-radius: 5px;
    text-align: left;
  }

  .list button:hover {
    background: var(--panel-2);
  }

  .list.compact li {
    display: flex;
    gap: 8px;
    padding: 1px 4px;
  }

  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .comment {
    border-left: 2px solid var(--line);
    padding: 2px 0 2px 8px;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .cmeta {
    display: flex;
    gap: 6px;
    font-size: 11px;
  }

  .cmeta a {
    color: var(--muted);
  }

  .score {
    margin-left: auto;
  }

  .ctext {
    overflow-wrap: anywhere;
  }
</style>
