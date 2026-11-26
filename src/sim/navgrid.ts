/**
 * A walkable grid: cells can be blocked, and the edges between cells can be walled.
 * Generic on purpose: no building or UI concepts, so it can be reused (e.g. a traffic game).
 */
export interface NavGrid {
  w: number;
  h: number;
  /** 1 = cell can't be entered. Index y * w + x. */
  blocked: Uint8Array;
  /** 1 = wall on the horizontal edge above cell (x, y). Index y * w + x, y in 0..h. */
  hWall: Uint8Array;
  /** 1 = wall on the vertical edge left of cell (x, y). Index y * (w + 1) + x, x in 0..w. */
  vWall: Uint8Array;
}

export function createNavGrid(w: number, h: number): NavGrid {
  return {
    w,
    h,
    blocked: new Uint8Array(w * h),
    hWall: new Uint8Array(w * (h + 1)),
    vWall: new Uint8Array((w + 1) * h),
  };
}

export const cellIndex = (g: NavGrid, x: number, y: number): number => y * g.w + x;
export const cellX = (g: NavGrid, i: number): number => i % g.w;
export const cellY = (g: NavGrid, i: number): number => Math.floor(i / g.w);

export function inBounds(g: NavGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function walkable(g: NavGrid, x: number, y: number): boolean {
  return inBounds(g, x, y) && g.blocked[y * g.w + x] === 0;
}

/** Can you step orthogonally from (x, y) by (dx, dy)? */
function orthStep(g: NavGrid, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (!walkable(g, nx, ny)) return false;
  if (dx === 1) return g.vWall[y * (g.w + 1) + x + 1] === 0;
  if (dx === -1) return g.vWall[y * (g.w + 1) + x] === 0;
  if (dy === 1) return g.hWall[(y + 1) * g.w + x] === 0;
  return g.hWall[y * g.w + x] === 0;
}

/** Can you step from (x, y) by (dx, dy)? Diagonals need both L-shaped routes clear (no corner cutting). */
export function canStep(g: NavGrid, x: number, y: number, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return orthStep(g, x, y, dx, dy);
  return (
    orthStep(g, x, y, dx, 0) &&
    orthStep(g, x + dx, y, 0, dy) &&
    orthStep(g, x, y, 0, dy) &&
    orthStep(g, x, y + dy, dx, 0)
  );
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Neighbor cells reachable in one step, with step cost (1 or √2). */
export function forEachNeighbor(g: NavGrid, i: number, fn: (j: number, cost: number) => void): void {
  const x = i % g.w;
  const y = (i - x) / g.w;
  for (const [dx, dy, cost] of DIRS) {
    if (canStep(g, x, y, dx, dy)) fn((y + dy) * g.w + x + dx, cost);
  }
}
