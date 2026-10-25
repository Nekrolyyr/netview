"""Build tests/fixtures/synthetic.netview: a small bundle from a synthetic dataset (no real data).

Run with the Python of the har-analyzer checkout (it imports har_analyzer):

    ..\\..\\Instagram_HAR_analyzer\\.venv\\Scripts\\python scripts\\make_fixture.py

Three groups of users follow their own hubs (-> communities), two whitelist accounts post media that
the groups like and comment on with timestamps, three influencers sit in between, and every comment
gets a synthetic sentiment rating (group A supportive, group C hostile). Posts 1 and 2 get generated
images (post 2 a carousel of three), post 0 a short test video with a separate audio track (needs ffmpeg
and Pillow); the export puts them into tests/fixtures/media/.
"""

import random
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
import tempfile
from pathlib import Path

from har_analyzer.analysis import communities, store
from har_analyzer.config import Paths
from har_analyzer.restructure.pipeline import load_schema
from har_analyzer.viewer_export.pipeline import ViewerOptions, run

T0 = 1_759_300_000            # 2025-10-01
DAY = 86_400
OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "synthetic.netview"


def build(root: Path) -> Paths:
    rng = random.Random(7)
    paths = Paths(root=root)
    paths.data.mkdir(parents=True, exist_ok=True)
    (root / "post_whitelist.txt").write_text("source_one\nsource_two\n", encoding="utf-8")
    (root / "analysis.toml").write_text(
        "[communities]\nmax_df = 0.5\nthreshold = 0.3\nmin_size = 3\n"
        "[viewer]\nmin_community_size = 3\nsentiment_min_n = 2\ncommunity_iterations = 80\nglobal_iterations = 60\n",
        encoding="utf-8")
    conn = sqlite3.connect(paths.dataset_db)
    conn.executescript(load_schema())
    users = [("S1", "source_one", 250_000, 1), ("S2", "source_two", 40_000, 1)]
    users += [(f"I{i}", f"influencer_{i}", 20_000 + i * 15_000, 1) for i in range(3)]
    groups = {g: [f"{g}{i:02d}" for i in range(40)] for g in "ABC"}
    for g, members in groups.items():
        users += [(u, f"{g.lower()}_user_{u[1:]}", rng.randint(50, 3000), 1) for u in members]
    users += [(f"L{i:03d}", f"leaf_{i:03d}", rng.randint(10, 400), 0) for i in range(120)]
    conn.executemany("INSERT INTO users (user_id, username, follower_count, profile_fetched, full_name) "
                     "VALUES (?, ?, ?, ?, 'Synthetic user')", users)
    follows = set()
    for g, members in groups.items():
        hubs = [f"H{g}{k}" for k in range(4)]
        conn.executemany("INSERT INTO users (user_id, username, follower_count, profile_fetched) VALUES (?, ?, 900, 1)",
                         [(h, f"hub_{h[1:].lower()}") for h in hubs])
        for u in members:
            for h in rng.sample(hubs, 3):
                follows.add((u, h))
            for v in rng.sample(members, 3):
                if v != u:
                    follows.add((u, v))
            if rng.random() < 0.3:
                follows.add((u, f"I{rng.randrange(3)}"))
            follows.add((u, rng.choice(["S1", "S2"])))
    for i in range(120):
        follows.add((f"L{i:03d}", rng.choice(["S1", "S2", "I0", "A00", "B00"])))
    conn.executemany("INSERT INTO follows (follower_id, followee_id, source) VALUES (?, ?, 'following_list')",
                     sorted(follows))
    comment_id = 0
    ratings = []
    for k in range(12):
        owner = "S1" if k % 3 else "S2"
        pk, taken = f"M{k:02d}", T0 + k * 2 * DAY
        conn.execute("INSERT INTO media (media_pk, code, owner_id, kind, taken_at, caption, like_count, comment_count) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (pk, f"CODE{k:02d}", owner, "reel" if k % 4 == 0 else "post", taken, f"Synthetic post {k}", 0, 0))
        conn.execute("INSERT INTO media_authors VALUES (?, ?, 'owner')", (pk, owner))
        g = "ABC"[k % 3]
        likers = rng.sample(groups[g], 15) + rng.sample(groups["ABC"[(k + 1) % 3]], 4)
        conn.executemany("INSERT INTO likes (media_pk, user_id, source) VALUES (?, ?, 'likers')",
                         [(pk, u) for u in likers])
        for u in rng.sample(groups[g], 6):
            comment_id += 1
            cpk = f"c{comment_id}"
            conn.execute("INSERT INTO comments (comment_pk, media_pk, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
                         (cpk, pk, u, f"synthetic comment {comment_id}", taken + rng.randint(60, 3 * DAY)))
            ratings.append((cpk, {"A": 4.0, "B": 1.0, "C": -3.5}[g] + rng.uniform(-1, 1)))
        conn.execute("UPDATE media SET like_count = ?, comment_count = 6 WHERE media_pk = ?", (len(likers), pk))
    _media_files(paths)
    conn.execute("INSERT INTO build_info VALUES ('built_at', '2026-10-24T00:00:00+00:00')")
    conn.commit()
    conn.close()

    communities.run(paths)
    with store.opened(paths) as a:
        run_id = store.start_run(a, "comments", {})
        a.execute("INSERT INTO prompts VALUES ('synthetic', 'sentiment', 'synthetic', '{}', '2026-10-24', '2026-10-24')")
        a.executemany("INSERT INTO comment_ratings VALUES (?, 'sentiment', 'synthetic', ?, 'ok', '', 0, ?)",
                      [(c, round(s, 2), run_id) for c, s in ratings])
        store.finish_run(a, run_id, {})
    return paths


def _media_files(paths: Paths) -> None:
    """Downloaded files as har-analyzer saves them: data/media/<owner>/<date>_<code>[_<n>].<ext>."""
    from PIL import Image, ImageDraw

    def stem(k: int) -> str:
        day = datetime.fromtimestamp(T0 + k * 2 * DAY, timezone.utc).strftime("%Y-%m-%d")
        return f"{day}_CODE{k:02d}"

    folder = paths.data / "media" / "source_one"
    folder.mkdir(parents=True, exist_ok=True)
    for k, items in ((1, [0]), (2, [1, 2, 3])):
        for n, hue in zip(items, ((60, 40, 120), (30, 110, 90), (140, 50, 60), (40, 70, 150))):
            image = Image.new("RGB", (480, 600), hue)
            ImageDraw.Draw(image).text((24, 24), f"synthetic post {k}" + (f" / {n}" if n else ""), fill="white")
            image.save(folder / f"{stem(k)}{f'_{n}' if n else ''}.jpg", quality=70)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("ffmpeg not found: the fixture gets no video")
        return
    base = [ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-t", "2"]
    subprocess.run([*base, "-i", "testsrc=size=320x400:rate=10", "-pix_fmt", "yuv420p", str(folder / f"{stem(0)}.mp4")],
                   check=True)
    subprocess.run([*base, "-i", "sine=frequency=440", "-c:a", "aac", str(folder / f"{stem(0)}.audio.m4a")], check=True)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        paths = build(Path(tmp))
        shutil.rmtree(OUT.parent / "media", ignore_errors=True)
        # synthetic names, nothing to anonymise; no thumbnails, so the viewer falls back to the image files
        out = run(paths, ViewerOptions(out=OUT, thumbnails=False, anonymize=False))
    print(f"wrote {out} ({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    sys.exit(main())
