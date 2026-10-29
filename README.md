# netview

A local 3D viewer for the Instagram network that
[har-analyzer](../../Instagram_HAR_analyzer) exports. Everything heavy is precomputed in the
export (graph, absorption, communities, sentiment, 3D layout, activation times, media reach). The
viewer only loads the bundle and draws it. The design is in [../NETWORK_VIEWER_PLAN.md](../NETWORK_VIEWER_PLAN.md).

## Quick start

```bash
# 1. in the har-analyzer checkout: communities once, then the bundle
har-analyzer analyze communities --threshold 0.4
har-analyzer export --format viewer          # -> data/export/viewer/network.netview

# 2. here (Node.js 20+)
npm install
npm run dev                                  # http://localhost:5173, then open the .netview file
```

`npm run build` writes a static site to `dist/`. Serve it with `npm run preview` or any static file
server. The page has to be served (not opened via `file://`) because it loads WebAssembly and a worker.
The bundle is read in the browser and never uploaded. Apart from the default bundle (below) and the
Instagram profile and post links that you click, the app makes no network requests.

### Default bundle

On start the app requests `data/default.netview` and opens it if the server has one; otherwise it
shows the file picker. The downloaded media that the export put next to the bundle (`media/`) are
served as `data/media/`; they are only shown for this server bundle, not for a file opened from disk.
Locally, point `NETVIEW_DATASET` at a bundle before `npm run dev` or `npm run preview`:

```powershell
$env:NETVIEW_DATASET = "..\..\Instagram_HAR_analyzer\data\export\viewer\network.netview"; npm run dev
```

## Docker (Traefik, https://netview.vault.akiba-z.ch)

`docker-compose.yml` builds the static site into an nginx image and puts it behind Traefik with a
Let's Encrypt certificate. The DNS record for `netview.vault.akiba-z.ch` has to point at the host,
and ports 80 and 443 have to be free and reachable from outside.

```bash
cp .env.example .env      # set ACME_EMAIL, NETVIEW_DATA_DIR and NETVIEW_DATASET_FILE
docker compose up -d --build
```

`NETVIEW_DATA_DIR` (default `./data`) is mounted read-only at `/data`, and
`$NETVIEW_DATA_DIR/$NETVIEW_DATASET_FILE` is served as the default bundle, and
`$NETVIEW_DATA_DIR/media/` as its media. Point `NETVIEW_DATA_DIR` at har-analyzer's
`data/export/viewer`. If you replace the file,
the next page load picks it up without a restart. Note that anyone who can reach the URL can download
the bundle. To require a login, enable the basic-auth labels in `docker-compose.yml`.

## Using it

| | |
|---|---|
| **Rotate / zoom / pan** | left drag · wheel (zooms towards the cursor) · right drag |
| **Select** | click a node, or a community cloud to focus it (everything else fades); double click flies to it; `Esc` clears |
| **View modes** | `1` Network (nodes, links, faint clouds) · `2` Community (clouds and sentiment arrows, plus unclustered accounts with > 10k followers) · `3` Influencer (influencers and source accounts on the clouds) |
| **Ordered views** | flat layouts seen from the front, the nodes morph into place: `4` Sentiment (communities along an axis by their mean sentiment towards the GSF, unrated ones in a column on the right) · `5` Radial (source accounts in the middle; the larger the share of a community's members linked directly to a source account, the closer the community) · `6` Ring (communities clockwise by size from 12 o'clock, source accounts in the middle). Accounts in no community sit between the communities they are linked to. |
| **Sphere** | `7`: every account on the surface of an opaque ball, which hides whatever lies behind it. Communities keep their directions from the 3D layout and become outlined, coloured areas that may overlap (their colours mix); links run along the surface as great-circle arcs. Hover or click an area for its community; double click flies down onto it. |
| **Search** | `/`, type a username, `Enter` flies to it |
| **Time seeker** | drag or click the histogram, `←/→` one day (`Shift`: a week), `Home/End`, `Space` plays. Gray = not active yet. Users without any time turn coloured at the end. |
| **Media** | click the thumbnail of a downloaded post (▶ / ⤢) to view it: images, videos with sound, carousels (`←/→`), caption and counts; `Esc` closes. Click a post to filter by its reach (interacted = direct, their neighbours = one hop); `Ctrl`-click adds, `Shift`-click selects a range. Groups: build them from the selection, drag posts onto a group, double click renames, export and import as JSON. The time seeker then shows when the reach grew. |
| **Settings** (⚙) | node size, cloud and link intensity, number of node labels, community labels, level of detail, link types, auto-rotate. Defaults: nodes 0.5×, clouds 2×, links 0.1×, no node labels. |

Colours: a node is filled with its community's colour (white: in no community); source (whitelist)
accounts wear a red ring, influencers a pink one. The six largest communities (with absorbed accounts)
have their own colour from a palette validated for all pairs on the dark background, smaller ones are
grey, the source accounts light grey. Node size grows with the number of absorbed one-link accounts.
Community names sit at their clouds. Node labels (off by default) are drawn only for influencers and
source accounts on the side facing you that are not hidden behind other nodes, and never overlap.
Zoomed out, ordinary accounts recede and links fade (level of detail); zoom in for the details.

## Architecture

```
src/
├── data/      db.worker.ts (sql.js: open, panel queries, reach union, thumbnails), client.ts,
│              decode.ts (typed-array BLOBs), graph.ts (CSR adjacency, search), types.ts
├── state/     store.ts – Svelte stores (mode, time, media selection, groups, selection, settings)
├── filters/   time.ts – effective time per node (seeker × media reach), absorbed growth, cloud activity
│              visibility.ts – what each view mode shows
├── render/    NetworkScene.ts – renderer, orbit controls, GPU picking, labels, transitions
│              layouts.ts – the ordered layouts (sentiment, radial, ring) and the sphere
│              layers.ts – nodes (points), links (line segments or arcs on the ball), clouds (splats
│              accumulated offscreen and composited as average colour by coverage), sentiment arrows
│              (tubes), the ball of the sphere view (community caps in its shader)
│              shaders.ts, labelPlacement.ts (greedy collision-free placement)
└── ui/        TopBar, LeftSidebar (media, groups), RightSidebar (Overview / NodePanel / CommunityPanel),
               TimeSeeker, Legend, Settings, Viewport, DropZone
```

The time seeker and the media filter combine through one value per node:
`t_eff = t_act` without a media selection (`t_max` for users without a time), otherwise the earliest
reach time over the selected media. A node is coloured when `t_eff ≤ seeker`. Scrubbing changes a
single shader uniform, and a media selection change recomputes one array in the worker.

## Tests

```bash
npm run check        # svelte-check / TypeScript
npm test             # unit tests (vitest)
npm run test:e2e     # Playwright smoke test against the production build, in the installed Chrome
```

`tests/fixtures/synthetic.netview` is built from synthetic data only. Rebuild it after a change to
the bundle format, using the Python of the har-analyzer checkout:

```bash
..\..\Instagram_HAR_analyzer\.venv\Scripts\python scripts\make_fixture.py
```

`scripts/screenshot.mjs` and `scripts/screenshot2.mjs` take screenshots of a bundle in every view
(development aid; they need `npm run preview` running).
