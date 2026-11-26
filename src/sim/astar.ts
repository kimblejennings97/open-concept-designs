import { type NavGrid, forEachNeighbor } from './navgrid';

export interface Path {
  /** Cell indices from start to goal, inclusive. */
  cells: number[];
  /** Length in cells (diagonal steps count √2). */
  cost: number;
}

/** A* over the grid with an octile-distance heuristic. Returns null if the goal can't be reached. */
export function findPath(g: NavGrid, start: number, goal: number): Path | null {
  if (start === goal) return { cells: [start], cost: 0 };
  if (g.blocked[goal] || g.blocked[start]) return null;
  const n = g.w * g.h;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % g.w;
  const gy = (goal - gx) / g.w;
  const h = (i: number) => {
    const x = i % g.w;
    const dx = Math.abs(x - gx);
    const dy = Math.abs((i - x) / g.w - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const heap = new MinHeap();
  gScore[start] = 0;
  heap.push(start, h(start));
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const base = gScore[cur];
    forEachNeighbor(g, cur, (j, cost) => {
      const t = base + cost;
      if (t < gScore[j]) {
        gScore[j] = t;
        came[j] = cur;
        heap.push(j, t + h(j));
      }
    });
  }
  if (gScore[goal] === Infinity) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  return { cells, cost: gScore[goal] };
}

/** Binary min-heap of (item, priority). Stale duplicates are skipped by the caller. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    const { items, prio } = this;
    items.push(item);
    prio.push(p);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= prio[i]) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      [prio[i], prio[parent]] = [prio[parent], prio[i]];
      i = parent;
    }
  }

  pop(): number {
    const { items, prio } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prio.pop()!;
    if (items.length) {
      items[0] = lastItem;
      prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && prio[l] < prio[m]) m = l;
        if (r < items.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        [prio[i], prio[m]] = [prio[m], prio[i]];
        i = m;
      }
    }
    return top;
  }
}
