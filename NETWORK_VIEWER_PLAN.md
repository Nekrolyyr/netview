# Network Viewer – Plan

A local web application that shows the Instagram dataset of the
[HAR analyzer](../Instagram_HAR_analyzer) as a 3D network graph. The heavy work (graph building,
leaf absorption, communities, layout, time and reach computation) runs **once in Python** in a new
analyzer export. The viewer only loads a precompiled bundle and renders it.

```
Instagram_HAR_analyzer                                   PythonProject (this repo)
──────────────────────                                   ─────────────────────────
03_dataset.sqlite ─┐                                     netview (TypeScript, three.js)
04_analysis.sqlite ┼─► har-analyzer export --format viewer ─► data/export/viewer/<name>.netview
post_whitelist.txt ┘        (har_analyzer/viewer_export/)        (one SQLite file) ─► loaded in the browser
data/media/ (thumbnails)
```

---

## 0. What the data looks like (measured on the current dataset)

| | Count | What it means for the plan |
|---|---|---|
| Users in the dataset | 111,818 | |
| Users with at least one user–user link | 100,126 | Media are not nodes, so links are derived through posts (see §2.1). |
| …of which have exactly one neighbour (leaves) | **88,475** | Absorbed into their neighbour → only **~11,650 visible nodes**. |
| Distinct user pairs | 132,860 | Most of them touch a leaf; ~40–50k remain between visible nodes. |
| Users with an exact action time (`v_events`) | 17,410 | Activated directly by the time seeker. |
| Users with only a one-hop derived time | 58,657 | Activated through a timed neighbour. |
| Users with no time at all | ~24,000 | Have no timed neighbour; they activate at the end of the timeline (§6.1). |
| Users with > 10,000 followers | 385 | Influencers. Only known where `profile_fetched = 1`. |
| Time range of exact actions | 2025-06-20 → 2026-10-05 | |
| Comment ratings | 41,597 | Basis for sentiment. |
| `community_membership` rows | **0** | `analyze communities` has never been run. The export must run it or require it first. |

~12k nodes, ~50k edges and a few hundred cloud splats are small for WebGL. The viewer can render
everything at 60 fps without level-of-detail tricks, so the plan puts its effort into a clean data
format and correct rules, not into rendering optimisation.

---

## 1. Decisions and assumptions (please confirm or correct)

1. **"Function links"** is read as the *interaction links* between users: follow, like, comment,
   reply, mention, tag and co-author. Every link keeps its types, so each type can be switched on or
   off in the network view.
2. **Sentiment between communities.** The comment ratings measure attitude *towards the GSF*, not
   towards the person a comment answers. Comments were also only collected on whitelist posts. The
   matrix "sentiment of community A towards community B" is therefore built as follows:
   - A → B = mean sentiment of comments by members of A on posts **owned by members of B**, plus
     replies by A to comments by B members.
   - This makes most arrows point to the communities that contain GSF accounts. Arrows between two
     non-GSF communities only exist through replies, and they still measure the reply's attitude
     towards the GSF.
   - Optional extension (§2.4): a new rating prompt, *stance towards the parent comment* (agree /
     disagree), would give real A ↔ B sentiment for replies.
3. **Absorption** runs once over the original leaves. It does not repeat, because repeating would
   collapse whole chains and trees into one node. **Whitelist accounts and influencers are never
   absorbed.** They stay visible even when they have only one link.
4. **Influencer** means `follower_count > 10,000`, and the threshold can be configured. Users without a
   fetched profile have no count, so they are never influencers. Profile enrichment (`targets` plus
   the collector) closes this gap.
5. **Colour priority:** whitelist (bright red) > influencer (pink) > everyone else (white).
6. **Reach of a medium** uses the same rule as the time seeker. Users who interacted with the post are
   reached directly. Their neighbours are reached one hop further, and the reach goes no further.
   The post's authors do not pass reach on. Otherwise the main account (~3M followers) would reach
   the whole graph in one hop. This matches the existing `analyze activation` (E1 / E2).
7. **The viewer runs locally only.** The bundle contains personal data of third parties, so it is
   opened from disk and never uploaded. `--pseudonymize` and `--no-text` remove names and texts.

---

## 2. Part A – Analyzer: `har-analyzer export --format viewer`

The export is a new package `src/har_analyzer/viewer_export/`, called from the existing `export`
command. Its settings live in `analysis.toml` under `[viewer]`. All steps are deterministic (fixed
seed), so the same inputs give the same bundle.

```
har-analyzer export --format viewer
    [--community-run ID | --run-communities]   # default: latest run in 04_analysis
    [--influencer-min 10000] [--seed 42]
    [--reuse-layout PREVIOUS.netview]          # keep positions stable between exports
    [--pseudonymize] [--no-text] [--no-thumbnails]
    [--out data/export/viewer/<name>.netview]
```

### Module overview

| # | Module | Input | Output |
|---|---|---|---|
| A1 | `graph.py` | dataset | Typed, undirected user graph with edge weights and times |
| A2 | `absorb.py` | A1 | Visible nodes, host ↔ absorbed mapping |
| A3 | `communities.py` | 04_analysis, A2 | Community per visible node, community sizes |
| A4 | `sentiment.py` | ratings, A3 | Community × community sentiment, mean sentiment per community |
| A5 | `overlap.py` | A1, A3 | Community × community overlap |
| A6 | `layout/macro.py` | A3–A5 | 3D centre and radius per community |
| A7 | `layout/fa3d.py` | A2, A6 | 3D ForceAtlas2 node positions |
| A8 | `layout/no_overlap.py` | A7 | Final positions with no overlapping nodes |
| A9 | `clouds.py` | A8, A3 | Cloud splats and ellipsoid per community |
| A10 | `timing.py` | `v_events`, A1 | Activation time and time kind per node, absorbed timelines |
| A11 | `reach.py` | dataset, A1 | Reach per media (direct and one hop, with times) |
| A12 | `bundle.py` | all of the above | The `.netview` SQLite file |
| A13 | `cli` + `config` | | Command, `[viewer]` config, logging, `build_info` |

### 2.1 A1 – User graph (`graph.py`)

Media are not nodes. Each interaction becomes a user–user link:

| Source | Link | Time |
|---|---|---|
| `follows` | follower → followee | none |
| `likes` | liker → media owner (and co-authors) | none (lower bound: `media.taken_at`) |
| `comments` | commenter → media owner | `created_at` (exact) |
| `comments` with parent | replier → parent author | `created_at` (exact) |
| `mentions` | author → mentioned user | `created_at` (exact, NULL if edited) |
| `media_tags` | owner → tagged user | `taken_at` |
| `media_authors` | owner ↔ co-author | `taken_at` |

- Links are kept per pair as `(src, dst, type_mask, weight, first_time)`. `weight` is the sum of the
  type weights from `[viewer.edge_weights]`. Direction is kept for the info panel and the arrows.
  Layout and absorption treat the graph as undirected.
- The logged-in user is already excluded in the dataset. Self-links are dropped.
- The SQL can largely be reused from `analysis/communities.py` (`BLOCK_SQL`) and
  `analysis/activation.py` (`PRIMARY_SQL`).

### 2.2 A2 – Leaf absorption (`absorb.py`)

- Leaf = a user with exactly one distinct neighbour who is neither a whitelist account nor an influencer.
- Each leaf is absorbed by its neighbour, the *host*. The host stores `absorbed_count` and a list of
  `(user, link type, activation time)` for the info panel and the time-dependent size.
- If two leaves are each other's only neighbour (an isolated pair), the one with more followers is kept.
- Node size in the viewer is `base · (1 + k · √absorbed_active)`. The exporter writes the parameters
  `base` and `k` from the config.
- About 88k leaves disappear, so the bundle has about 11.7k visible nodes.

### 2.3 A3 – Communities (`communities.py`)

- Reads a run of the existing `analyze communities` (cosine similarity of follow / engagement /
  mention vectors, Louvain). With `--run-communities` it starts that run first.
- Membership is mapped onto the visible nodes:
  - Absorbed leaves inherit their host's community.
  - Communities below `[viewer].min_community_size` are dissolved, and their members count as *unclustered*.
  - Unclustered nodes get `community = NULL`. They are laid out by ForceAtlas only (§2.6) and shown as in §4.
- A community's label comes from `community_summary.top_users` / `top_features`. Its colour comes from
  a fixed, well-separated palette and must not use red, pink or white, which are reserved for nodes.
- Leiden on the interaction graph can replace this later through the same interface (`communities.method`).

### 2.4 A4 – Sentiment (`sentiment.py`)

- Uses the ratings of one configured prompt and model (`[viewer].sentiment_prompt`, default: the
  active sentiment prompt).
- Mean sentiment per community: the mean over all rated comments by its members (−5…+5), with the
  count. `community_summary.mean_sentiment` already holds this.
- Matrix `S[A][B] = (mean, n, std)` as defined in §1.2. A pair is only exported when `n ≥ min_n`
  (default 5), so a few comments do not produce a strong arrow.
- *Optional:* a prompt `stance_parent` in `analysis.toml` rates replies as agreeing or disagreeing with
  their parent comment. When it is present, the reply part of `S` uses it.

### 2.5 A5 – Overlap (`overlap.py`)

Overlap between communities A and B, used by the layout and by the cloud rendering:

- `cross_weight(A,B)`: the summed link weight between members of A and B, normalised by
  `√(vol(A)·vol(B))`.
- `shared_neighbours(A,B)`: the Jaccard index of their neighbour sets. This catches communities that
  follow the same accounts without linking to each other directly.
- `overlap = α·cross + (1−α)·jaccard`, with α configurable.

### 2.6 Layout pipeline (A6–A8)

Rules 1–4 of the requirements, applied in this order:

**A6 – Community placement (macro layout, rules 3 and 4).** Every community is a sphere with radius
`r = c · size^(1/3)`. The 3D centres are computed with stress majorisation (SMACOF, numpy). The
target distance between two communities is

```
d(A,B) = (r_A + r_B) · (1 − overlap(A,B))            # strong overlap → spheres interpenetrate
         · (1 + β · max(0, −S_sym(A,B)) / 5)          # hostile → further apart
         · (1 − γ · max(0,  S_sym(A,B)) / 5)          # supportive → closer
```

A soft axis term places each community along x by its mean sentiment towards the GSF. Supportive
communities move towards the whitelist core and hostile ones away from it, which makes the picture
readable at a glance. The third dimension is what lets several communities overlap the same
neighbour without overlapping each other.

**A7 – 3D ForceAtlas2 (rules 1 and 2).**
- Initial position: each node starts randomly inside its community sphere. Unclustered nodes start
  near the mean position of their neighbours.
- Forces: standard FA2 (degree-weighted repulsion, linear attraction × edge weight, global gravity),
  plus a **community gravity** that pulls every member towards its community centre. Unclustered
  nodes feel no community gravity, so they are placed by ForceAtlas alone.
- Implementation: numpy plus an optional `numba` dependency, Barnes–Hut octree (θ = 1.2), adaptive
  speed as in Gephi, and a fixed iteration count. ~12k nodes run in seconds to minutes.
- `--reuse-layout` starts from the previous bundle's positions, so the picture stays stable when the
  data grows.

**A8 – Overlap removal (rule 2).** After FA2, a separate pass using a `scipy.spatial.cKDTree` pushes
apart every pair of spheres closer than `size_a + size_b + margin`, until no overlap is left. Sizes
here are the final sizes with everything absorbed. This is more reliable than FA2's own
`adjustSizes` in 3D.

### 2.7 A9 – Community clouds (`clouds.py`)

- For each community: its centre, the covariance ellipsoid of the member positions (3×3) and a
  **set of splats**. These are about 50–400 points, sampled from the member positions weighted by
  size, each with a radius from the local density (k-nearest-neighbour distance).
- In the viewer the splats are drawn as soft Gaussian sprites with additive blending, which gives the
  hazy cloud. Where communities overlap, their colours mix.

### 2.8 A10 – Activation times (`timing.py`)

- `t_exact(u)` = the earliest action time where u is the actor in `v_events` (post, comment, reply,
  mention).
- `t_derived(u)` = the minimum `t_exact(v)` over all neighbours v **that have their own exact time**.
  It is never computed from other derived times, so activation propagates exactly one hop.
- `t_act = t_exact ?? t_derived ?? +∞`, with `t_kind ∈ {exact, derived, none}`.
- For each host, a sorted list of the absorbed leaves' `t_act` values, so the node can grow while the
  seeker moves.
- A histogram of activations per day (exact and derived separately) for the timeline track.

### 2.9 A11 – Media reach (`reach.py`)

For each whitelist medium M:

- **Direct** (level 1): likers, commenters, reposters and users mentioned in comments, with a time:
  the comment time where there is one, otherwise `M.taken_at` (kind `derived`).
- **One hop** (level 2): neighbours of the direct users in the user graph, *not* through the authors.
  Their time is the minimum time of the direct users they are linked to.
- Stored as sorted node indices with their times (delta-varint blobs). Absorbed leaves are mapped to
  their host, and `absorbed_reached` is counted per host.
- Groups are **not** precomputed. The viewer takes the union of the selected media (§6.2).

### 2.10 A12 – Bundle format (`bundle.py`)

One **SQLite file** (`.netview`), read in the browser with `sql.js` (WebAssembly):

- **Hot data** that the renderer needs for every node is stored as **little-endian typed-array
  BLOBs**. They become `Float32Array` / `Uint32Array` without parsing.
- **Detail data** (bio, comments, absorbed accounts) stays in normal tables and is queried with SQL
  when a node is selected.

```sql
meta(key TEXT PRIMARY KEY, value TEXT)
  -- schema_version, built_at, dataset_build_hash, community_run_id, influencer_min,
  -- t0 (epoch of time 0), t_min, t_max, node_count, edge_count, pseudonymized, colours, size params

arrays(name TEXT PRIMARY KEY, dtype TEXT, item_size INTEGER, length INTEGER, data BLOB)
  -- position   f32×3   (N)      community  u16 (N, 0xFFFF = unclustered)
  -- size_base  f32     (N)      flags      u8  (N: whitelist|influencer|verified|private|has_absorbed)
  -- t_act      f32     (N, seconds since t0, +Inf = never)    t_kind u8 (N)
  -- edge_src/edge_dst u32 (E)   edge_types u8 (E, bitmask)    edge_weight f32 (E)   edge_t f32 (E)
  -- adj_offsets u32 (N+1) / adj_nodes u32 / adj_edges u32      -- CSR for one-hop and the neighbour list
  -- absorbed_offsets u32 (N+1) / absorbed_t f32                 -- size growth over time
  -- label_priority f32 (N)                                       -- follower_count, for label sorting

nodes(idx INTEGER PRIMARY KEY, user_id, username, full_name, biography, is_verified, is_private,
      follower_count, following_count, media_count, profile_fetched, community_id, absorbed_count,
      t_act, t_kind)
absorbed(host_idx, user_id, username, link_types, t_act)
communities(id PRIMARY KEY, label, colour, size, size_with_absorbed, cx, cy, cz, radius,
            ellipsoid BLOB /* f32×9 */, splats BLOB /* f32×4: x,y,z,r */, mean_sentiment, n_rated,
            top_users, top_features)
community_sentiment(src, dst, mean, n, std)
community_overlap(a, b, overlap, cross_weight, jaccard)
media(media_pk PRIMARY KEY, code, owner_idx, owner_username, kind, taken_at, caption,
      like_count, comment_count, mean_sentiment, thumbnail BLOB /* webp, 160 px */)
media_reach(media_pk PRIMARY KEY, direct_idx BLOB, direct_t BLOB, hop_idx BLOB, hop_t BLOB,
            direct_count, hop_count, absorbed_reached)
comments(comment_pk, user_idx, media_pk, parent_comment_pk, created_at, text, sentiment, relevance)
timeline(day TEXT, exact INTEGER, derived INTEGER)
```

- Expected size: ~10–40 MB with thumbnails, 2–5 MB without (`--no-thumbnails`).
- `--pseudonymize` reuses `restructure/export.Pseudonymizer`. It hashes ids and usernames, drops names
  and bios, and with `--no-text` also drops comment texts and captions.
- `schema_version` is checked by the viewer. Incompatible bundles are rejected with a clear message.
- `build_info` in the dataset records the export, as it does for the other exports.

### 2.11 A13 – Tests (in the analyzer's `tests/`)

Synthetic fixtures (`conftest.py`) with a small, hand-checkable graph:

- Absorption: leaves, protected leaves (whitelist and influencer) and isolated pairs.
- Timing: exact times, a one-hop derived time, a two-hop node that must stay `none`.
- Reach: authors do not pass reach on; the one-hop times are correct.
- Sentiment matrix: correct direction and the `min_n` cut-off.
- Layout: deterministic for the same seed, no overlapping nodes after A8, members inside or near
  their sphere.
- Bundle: round trip (write → read with sqlite3 → typed arrays have the expected lengths).

---

## 3. Part B – Viewer: `netview` (this repo)

**Stack:** TypeScript · Vite · three.js (WebGL2, custom shaders) · sql.js in a Web Worker · Svelte 5
for the UI panels · Vitest and Playwright for tests. It runs as static files (`npm run build` → open
`dist/` or `npm run dev`). A bundle is loaded by file picker or drag-and-drop, and it never leaves
the machine.

### 3.1 Module overview

```
netview/src/
├── data/            B1  bundle loading and typed-array store
├── state/           B2  application state (one store, derived values)
├── filters/         B3  time and media reach → effective time per node
├── render/          B4  scene, camera, layers, shaders, picking
│   ├── NodesLayer       points with size / colour / activation shader
│   ├── EdgesLayer       line segments, per-type toggles
│   ├── CloudsLayer      Gaussian splats per community
│   ├── ArrowsLayer      sentiment arrows between communities
│   ├── LabelsOverlay    2D canvas, culled influencer labels
│   └── Picking          GPU id buffer
├── ui/              B5  TopBar, LeftSidebar, RightSidebar, TimeSeeker, Legend, Settings
└── workers/         B6  sql.js worker, reach/union worker
```

### 3.2 B1 – Data layer (`data/`)

- `loadBundle(file)` sends the file to the worker, which opens it with sql.js, checks
  `schema_version` and returns the `arrays` BLOBs as transferable `ArrayBuffer`s (zero copy).
- `Graph` holds the typed arrays and helpers: `neighbours(i)` (CSR), `edgesOf(i)`,
  `membersOf(community)`.
- `query.ts` holds async SQL calls for the panels: `nodeDetails(i)`, `absorbedOf(i)`,
  `commentsOf(i)`, `mediaList()`, `mediaReach(pk)`, `communityDetails(id)`.
- Thumbnails come from SQL BLOBs → `URL.createObjectURL` (lazy, with an LRU cache).

### 3.3 B2 – State (`state/`)

One store with these fields:

| Field | Values |
|---|---|
| `viewMode` | `network` / `community` / `influencer` |
| `seekerTime` | seconds since t0. Default: `t_max`, so everything is coloured. |
| `playing`, `playSpeed` | |
| `selectedMedia` | set of media pks |
| `mediaGroups` | named groups of media pks. Saved in `localStorage` per bundle hash; export/import as JSON. |
| `selectedNode`, `selectedCommunity`, `hoveredNode` | |
| `edgeTypes` | visible link types |
| `settings` | cloud opacity, label count, node scale, influencer threshold display |

Derived values (computed once per change, not per frame): `effectiveTime` (B3) and `visibleMask`
per mode (§4).

### 3.4 B3 – Filters (`filters/`)

The time seeker and the media filter work through one value per node, `t_eff`:

```
no media selected:  t_eff(u) = t_act(u)
media selected:     t_eff(u) = min over selected media M of reach_t_M(u)      (+∞ if not reached)
active(u)        ⇔  t_eff(u) ≤ seekerTime
```

- `t_eff` is a `Float32Array` vertex attribute. It is recomputed in a worker only when the media
  selection changes (a union of a few sorted index lists, a few ms) and then uploaded once.
- Moving the seeker only changes **one shader uniform** (`u_time`), so scrubbing is smooth.
- Absorbed growth: when the seeker stops (debounced), `absorbed_active(i)` is counted by binary
  search in `absorbed_t` and the size attribute is updated.
- Edges: an edge is active when both endpoints are active (`max(t_eff) ≤ u_time`). The same values
  are passed as edge attributes.

### 3.5 B4 – Rendering (`render/`)

- **Scene and camera:** `PerspectiveCamera` with an orbit control. Left drag rotates, the wheel zooms
  towards the cursor, right drag or Shift pans, a double click flies to a node, and `R` resets the
  view. Damping is on. Auto-rotate is optional.
- **Background:** off-black with a slight purple tint, `#14101C`, with a very faint radial vignette.
- **NodesLayer:** one `THREE.Points` with a custom shader. The point size is in world units with
  perspective. Disc with a soft edge and a light rim, so overlapping depth stays readable.
  - Colour: whitelist `#FF2A2A` (bright red), influencer `#FF5FC8` (pink), others `#F2F0F5` (white).
  - Inactive (`t_eff > u_time`): grayscale and dimmed (luma × 0.35, alpha 0.5).
  - Per-node visibility from the view mode (§4) as an attribute, with no geometry rebuild.
  - Selected node: glow ring; its neighbours are highlighted, everything else is dimmed.
- **EdgesLayer:** `LineSegments` with a custom shader. Alpha is low (0.06–0.15) with additive
  blending. Colour is the mix of the endpoint colours, or gray when inactive. Each type can be toggled
  through a bitmask uniform.
- **CloudsLayer:** instanced quads facing the camera (billboards) per splat, with a Gaussian falloff,
  the community colour, additive blending and no depth write. Opacity is set by the view mode: low
  in network view, full in community and influencer view. A soft breathing animation is optional.
- **ArrowsLayer (community view only):** one curved arrow per pair in `community_sentiment` with
  enough data. The arrow runs from the edge of A's cloud to the edge of B's. Green (`#3DDC84`) means
  mean > 0, red (`#FF4D4D`) means < 0. Width scales with `|mean|`, opacity with `log(n)`. A → B and
  B → A bend to opposite sides. Built as tube geometry, rebuilt only when the mode changes. Hovering
  shows mean, n and std.
- **LabelsOverlay:** a 2D canvas above the WebGL canvas, updated at most every 100 ms and after
  camera moves:
  1. Candidates are influencer and whitelist nodes that are visible in the current mode.
  2. **Facing the user:** the node must be in front of the camera (positive depth), on the camera's
     side of the node cloud (`dot(p − cloudCentre, camDir) < 0`), and not hidden behind a closer node.
     The last check samples the GPU id buffer at the node's pixel.
  3. Candidates are sorted by `label_priority`, then by distance to the camera.
  4. Labels are placed greedily into a screen-space occupancy grid. A label that would overlap is
     skipped, so no two labels overlap.
  5. Each label sits above its node, with a small fade in and out so labels do not flicker.
- **Picking:** an off-screen render pass writes node ids as colours, and one pixel is read on hover
  or click. It is exact, independent of the node count, and the label occlusion check reuses it.
  Communities are picked by the nearest cloud centre in screen space when no node is under the cursor.

### 3.6 B5 – UI (`ui/`)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ TopBar: [Network | Community | Influencer]   search @user…   legend   ⚙       │
├──────────────┬─────────────────────────────────────────────┬──────────────────┤
│ LeftSidebar  │                                             │ RightSidebar     │
│ Media        │                                             │ selected node    │
│ ▸ Groups     │              3D viewport                    │ or community     │
│ ▸ All posts  │                                             │                  │
│  ☐ thumb …   │                                             │                  │
├──────────────┴─────────────────────────────────────────────┴──────────────────┤
│ TimeSeeker  ▶  |▁▂▃▅▇▅▃▂▁▁▂▃▆█▆▃▂▁|  2025-09-30 14:00   speed ×   [reset]      │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **LeftSidebar – media**
  - Virtualised list of all media: thumbnail, owner, date, kind, likes and comments, mean sentiment
    as a small diverging bar, and direct / one-hop reach counts.
  - Filter by owner, date range and kind. Sort by date, reach or sentiment.
  - Multi-select with checkbox, Shift-click for a range, Ctrl-click to toggle.
  - **Groups:** create from the selection, rename, colour, delete, drag media into a group, and
    select a group with one click. Automatic groups: per owner and per week.
  - A "Clear filter" button. The active selection shows as a chip in the top bar.
- **RightSidebar – details**
  - Node: username (link to the profile), full name, verified and private status, bio, follower,
    following and media counts with coverage, role (whitelist / influencer), community (clickable),
    activation time and kind, the absorbed accounts (count and list), neighbours by link type
    (clickable), the user's comments with sentiment and relevance, the media they interacted with,
    and whether they were reached by the selected media (direct or one hop, with time).
  - Community: label, colour, size (with absorbed), mean sentiment, top users and top features,
    sentiment towards and from the other communities (table plus mini bars), the overlapping
    communities, and a member list.
- **TimeSeeker**
  - Track with the activation histogram (exact and derived stacked). Drag handle, play / pause,
    speed, step by day, and a date label.
  - The start of the timeline (`t_min`) makes everything gray, and the end colours everything (users
    with no time activate at `t_max`, see §6.1).
  - When a media filter is active, the histogram shows the reach of the selection instead.
- **TopBar:** view mode switch (keys `1` / `2` / `3`), username search with autocomplete that flies to
  the node, the legend for colours, arrows and gray, and settings.

### 3.7 B6 – Workers

- `db.worker.ts`: sql.js, all SQL, and BLOB → `ArrayBuffer` transfer.
- `reach.worker.ts`: the union of reach lists for the selected media and the `t_eff` array; counting
  absorbed growth.
- The main thread only does rendering and UI.

---

## 4. View modes – visibility rules

| Element | 1 Network | 2 Community | 3 Influencer |
|---|---|---|---|
| Community members | visible | hidden | only influencers and whitelist accounts |
| Unclustered, > 10k followers | visible | **visible** | visible |
| Unclustered, others | visible | hidden | hidden |
| Influencer labels | visible (culled) | for visible nodes | visible (culled) |
| Links | visible (per type) | hidden | optional (off by default) |
| Community clouds | low opacity (~0.15) | full | full |
| Sentiment arrows | hidden | **visible** | hidden |
| Time and media filter | nodes, links | visible nodes; cloud brightness = share of active members | nodes, clouds |

In the community view the clouds follow the time and media filters. Each cloud's brightness and
saturation scale with the share of its members (including absorbed) that are active. The cloud
"fills up" while the seeker plays.

Switching modes animates the opacities over about 300 ms. Positions never change, so the user keeps
their orientation.

---

## 5. Implementation phases

| Phase | Analyzer (Part A) | Viewer (Part B) | Result |
|---|---|---|---|
| **0 Spec** | Fix schema v1, synthetic fixture bundle | Project skeleton (Vite, TS, three.js, Svelte, sql.js) | Both sides build against the same sample file |
| **1 MVP** | A1 graph, A2 absorption, A3 communities (existing run), simple 3D FA2, A12 bundle | B1 loading, nodes, orbit and zoom, picking, RightSidebar (node) | Real data visible and clickable in 3D |
| **2 Layout** | A5 overlap, A4 mean sentiment, A6 macro layout, community gravity, A8 overlap removal, A9 clouds | Clouds, colours, background, edges per type, label culling | The final picture |
| **3 Modes** | A4 sentiment matrix | Three view modes, arrows, community panel, legend | Community and influencer views |
| **4 Time** | A10 timing and timeline | TimeSeeker, `t_eff`, gray shader, play, absorbed growth | Growth over time |
| **5 Media** | A11 reach, thumbnails | LeftSidebar, groups, reach union, combined filter | Media reach, alone and with time |
| **6 Polish** | `--reuse-layout`, `--pseudonymize` / `--no-text`, tests, README section | Search, settings, keyboard shortcuts, performance checks, Playwright smoke tests, README | Ready to use |

Phases 1–2 are the largest. Phases 3–5 build on the bundle format and the shader attributes and can
be developed independently of each other.

---

## 6. Open points and edge cases

1. **Users with no time (~24k):** the plan colours them at `t_max`, so the end of the timeline shows
   the full network. The alternative is to keep them gray for good and show a "no time" note in the
   legend.
2. **Likes have no time.** For reach they use the media's publish time as a lower bound. For
   `t_act` they count only through the one-hop rule.
3. **The influencer threshold depends on profile coverage.** The info panel shows "follower count
   unknown" when `profile_fetched = 0`. More enrichment runs improve the influencer layer.
4. **The community run is missing** (`community_membership` is empty). Before the first export, run
   `har-analyzer analyze communities` with a threshold sweep and pick a threshold. Without
   communities, every node counts as unclustered and is laid out by FA2 alone.
5. **Community stability:** a new community run changes ids and colours. A mapping by member overlap
   (Jaccard against the previous bundle) keeps colours stable. It belongs to `--reuse-layout`.
6. **Privacy:** bundles go into the git-ignored `data/export/viewer/`. The viewer has no network
   calls, no analytics and no CDN at run time; everything is bundled by Vite.

---

## 7. Implementation status (2026-10-24)

Every module of this plan is implemented: Part A in the analyzer (branch `viewer-export`,
`src/har_analyzer/viewer_export/`, 19 tests) and Part B in `netview/` (23 unit tests, Playwright
smoke tests). On the current dataset the export takes about 15 s and writes a 19.6 MB bundle with
11,685 nodes, 44,418 links, 31 communities and 1,676 media. The viewer runs at ~57 fps.

Changes made during implementation:

| Plan | Implemented | Why |
|---|---|---|
| Likes and comments link to the owner *and co-authors* | Owner only; co-authors keep their own `coauthor` link to the owner | Many GSF posts are collaborations between delegations. With co-authors, one like became several links and 36k instead of 12k nodes stayed visible. |
| Communities from `analyze communities` | Run #2 (threshold 0.4: 47 communities, modularity 0.80), plus an extra **"Source accounts"** community for whitelist accounts that are not in any community | Most GSF accounts, including `globalsumudflotilla`, are not in any community. Without them nearly every comment would point at "no community". |
| Barnes–Hut ForceAtlas2 | Exact repulsion, numba-parallel (numpy fallback) | Fast enough for ~12k nodes (a few seconds) and simpler. |
| One repulsion constant | Local constant inside communities, a weaker global one calibrated to the community extent, and a pre-scale before overlap removal | With a single constant the unclustered nodes ended up on a shell around the dense communities. |
| Clouds drawn additively | Accumulated offscreen and composited as average colour by coverage | 31 overlapping clouds added up to white. |
| Separate `reach.worker` | Reach union runs in the bundle worker, which already holds the reach BLOBs | Saves copying the blobs between workers. |
| Optional `stance_parent` prompt | Added and disabled by default (`[comments.prompts.stance_parent] enabled = false`). When enabled, the export uses it for replies. | |
