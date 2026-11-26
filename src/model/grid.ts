/**
 * Grid geometry. The blueprint is a grid of square cells, CELL_M meters on a side.
 *
 * Coordinates are in cell units: cell (x, y) covers [x, x+1] × [y, y+1], and
 * vertex (x, y) is the corner shared by four cells. Walls sit on cell *edges*:
 *   - "h" edge (x, y): horizontal, from vertex (x, y) to (x+1, y). Separates cell (x, y-1) above from (x, y) below.
 *   - "v" edge (x, y): vertical, from vertex (x, y) to (x, y+1). Separates cell (x-1, y) left from (x, y) right.
 */
export const CELL_M = 0.5;

export type Orient = 'h' | 'v';

export interface Edge {
  o: Orient;
  x: number;
  y: number;
}

export type CellXY = [number, number];

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function parseCell(key: string): CellXY {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export const edgeKey = (o: Orient, x: number, y: number): string => `${o}${x},${y}`;

export function parseEdge(key: string): Edge {
  const [x, y] = parseCell(key.slice(1));
  return { o: key[0] as Orient, x, y };
}

/** The two cells on either side of an edge (above/below for h, left/right for v). */
export function edgeSides(e: Edge): [CellXY, CellXY] {
  return e.o === 'h'
    ? [[e.x, e.y - 1], [e.x, e.y]]
    : [[e.x - 1, e.y], [e.x, e.y]];
}

/** Edge keys along an axis-aligned line between two vertices. Diagonal lines return []. */
export function lineEdges(ax: number, ay: number, bx: number, by: number): string[] {
  const out: string[] = [];
  if (ay === by) {
    for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) out.push(edgeKey('h', x, ay));
  } else if (ax === bx) {
    for (let y = Math.min(ay, by); y < Math.max(ay, by); y++) out.push(edgeKey('v', ax, y));
  }
  return out;
}

/** The edge closest to a world point, if within maxDist cells of a grid line. */
export function nearestEdge(wx: number, wy: number, maxDist: number): Edge | null {
  const hy = Math.round(wy);
  const vx = Math.round(wx);
  const dh = Math.abs(wy - hy);
  const dv = Math.abs(wx - vx);
  if (Math.min(dh, dv) > maxDist) return null;
  return dh <= dv
    ? { o: 'h', x: Math.floor(wx), y: hy }
    : { o: 'v', x: vx, y: Math.floor(wy) };
}

/** Format a length in cells as meters, e.g. 7 → "3.5 m". */
export function fmtMeters(cells: number): string {
  const m = cells * CELL_M;
  return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)} m`;
}
