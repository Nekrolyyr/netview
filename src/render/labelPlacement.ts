/**
 * Greedy, collision-free label placement in screen space.
 *
 * Candidates are tried in priority order; a label is placed when its rectangle does not intersect
 * any placed label. A uniform grid of cells keeps the test local.
 */

export interface LabelCandidate {
  id: number;
  /** anchor: centre-bottom of the label, in CSS pixels */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}

export interface PlacedLabel extends LabelCandidate {
  left: number;
  top: number;
}

export function placeLabels(candidates: LabelCandidate[], viewWidth: number, viewHeight: number,
  maxLabels: number, padding = 3, cell = 48): PlacedLabel[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const cols = Math.max(1, Math.ceil(viewWidth / cell));
  const grid = new Map<number, PlacedLabel[]>();
  const placed: PlacedLabel[] = [];
  for (const c of sorted) {
    if (placed.length >= maxLabels) break;
    const left = c.x - c.width / 2 - padding;
    const top = c.y - c.height - padding;
    const right = c.x + c.width / 2 + padding;
    const bottom = c.y + padding;
    if (left < 0 || top < 0 || right > viewWidth || bottom > viewHeight) continue;   // only labels that fit entirely
    const x0 = Math.max(0, Math.floor(left / cell));
    const x1 = Math.max(0, Math.floor(right / cell));
    const y0 = Math.max(0, Math.floor(top / cell));
    const y1 = Math.max(0, Math.floor(bottom / cell));
    let free = true;
    outer: for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (const p of grid.get(gy * cols + gx) ?? []) {
          if (left < p.left + p.width + 2 * padding && right > p.left
            && top < p.top + p.height + 2 * padding && bottom > p.top) {
            free = false;
            break outer;
          }
        }
      }
    }
    if (!free) continue;
    const label: PlacedLabel = { ...c, left, top };
    placed.push(label);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = gy * cols + gx;
        const list = grid.get(key);
        if (list) list.push(label);
        else grid.set(key, [label]);
      }
    }
  }
  return placed;
}
