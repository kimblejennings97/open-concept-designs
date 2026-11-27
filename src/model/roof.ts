/**
 * Roofs. A design has one roof style for the whole building. Pitched roofs are built over
 * a set of rectangles that cover the footprint (see roofPlan), so L- and T-shaped plans get
 * one roof section per wing, and the sections meet where they overlap.
 */
import { CELL_M, cellKey, parseCell } from './grid';

export type RoofStyle = 'gable' | 'hip' | 'shed' | 'flat';

export interface Roof {
  style: RoofStyle;
  /** Degrees. Ignored by flat roofs; shed roofs cap it at SHED_MAX_PITCH. */
  pitch: number;
  /** Roof material id (materials.json "roofs"). */
  material: string;
  /** Gable: ridge runs across the short side instead of the long one. Shed: slopes the other way. */
  turned: boolean;
}

export const ROOF_STYLES: Record<RoofStyle, { label: string; tags: string[]; hint: string }> = {
  gable: { label: 'Gable', tags: ['classic', 'cozy', 'rustic'], hint: 'Two slopes meeting at a ridge, with triangular wall ends.' },
  hip: { label: 'Hip', tags: ['classic', 'luxury'], hint: 'Slopes on all four sides. Sturdy and a little grander.' },
  shed: { label: 'Shed', tags: ['modern', 'rustic'], hint: 'One single slope. Low and modern.' },
  flat: { label: 'Flat', tags: ['modern', 'industrial'], hint: 'Flat deck with a parapet. Cheapest, typical for shops.' },
};

export const ROOF_PITCHES = [15, 25, 35, 45] as const;
export const SHED_MAX_PITCH = 15;
/** How far pitched roofs reach past the walls, in meters. */
export const EAVE_M = 0.35;

export const DEFAULT_ROOF: Roof = { style: 'gable', pitch: 25, material: 'asphalt', turned: false };

export function normalizeRoof(raw: unknown): Roof {
  const r = (raw ?? {}) as Partial<Roof>;
  return {
    style: r.style && r.style in ROOF_STYLES ? r.style : DEFAULT_ROOF.style,
    pitch: typeof r.pitch === 'number' && r.pitch >= 5 && r.pitch <= 60 ? r.pitch : DEFAULT_ROOF.pitch,
    material: typeof r.material === 'string' && r.material ? r.material : DEFAULT_ROOF.material,
    turned: r.turned === true,
  };
}

export function effectivePitch(roof: Roof): number {
  if (roof.style === 'flat') return 0;
  return roof.style === 'shed' ? Math.min(roof.pitch, SHED_MAX_PITCH) : roof.pitch;
}

/** Roof surface per m² of footprint (sloped roofs have more surface than floor). */
export function roofAreaFactor(roof: Roof): number {
  return 1 / Math.cos((effectivePitch(roof) * Math.PI) / 180);
}

// ---------------------------------------------------------------------------
// Plan: rectangles covering the footprint
// ---------------------------------------------------------------------------

/** A rectangle of cells [x0, x1) × [y0, y1), and the direction its ridge (or slope) runs. */
export interface RoofRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 'x' = ridge runs east–west, 'y' = north–south. Shed: the slope falls across this axis. */
  axis: 'x' | 'y';
}

/** All maximal rectangles inside a set of cells (can't grow in any direction). */
function maximalRects(cells: Set<string>): Array<Omit<RoofRect, 'axis'>> {
  if (!cells.size) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of cells) {
    const [x, y] = parseCell(k);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const has = (x: number, y: number) => cells.has(cellKey(x, y));
  const rowFull = (y: number, x0: number, x1: number) => {
    for (let x = x0; x < x1; x++) if (!has(x, y)) return false;
    return true;
  };
  const out: Array<Omit<RoofRect, 'axis'>> = [];
  const seen = new Set<string>();
  for (let y0 = minY; y0 <= maxY; y0++) {
    // Columns that are filled in every row from y0 to y1.
    const filled: boolean[] = [];
    for (let x = minX; x <= maxX; x++) filled.push(true);
    for (let y1 = y0; y1 <= maxY; y1++) {
      let any = false;
      for (let x = minX; x <= maxX; x++) {
        filled[x - minX] = filled[x - minX] && has(x, y1);
        any ||= filled[x - minX];
      }
      if (!any) break;
      // Each maximal run of filled columns is a rectangle that can't widen.
      for (let x = minX; x <= maxX; x++) {
        if (!filled[x - minX] || (x > minX && filled[x - 1 - minX])) continue;
        let xe = x;
        while (xe + 1 <= maxX && filled[xe + 1 - minX]) xe++;
        // Keep it only if it can't grow up or down either.
        if (rowFull(y0 - 1, x, xe + 1) || rowFull(y1 + 1, x, xe + 1)) continue;
        const key = `${x},${y0},${xe + 1},${y1 + 1}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ x0: x, y0, x1: xe + 1, y1: y1 + 1 });
        }
      }
    }
  }
  return out;
}

const MAX_SECTIONS = 24;

/**
 * Rectangles to put roof sections on: the largest maximal rectangles, picked until every
 * footprint cell is under at least one. Overlapping sections are fine; in 3D they merge.
 */
export function roofPlan(footprint: Set<string>, roof: Roof): RoofRect[] {
  const rects = maximalRects(footprint).sort(
    (a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0) || a.y0 - b.y0 || a.x0 - b.x0,
  );
  const uncovered = new Set(footprint);
  const picked: RoofRect[] = [];
  for (const r of rects) {
    if (!uncovered.size || picked.length >= MAX_SECTIONS) break;
    let covers = false;
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) covers = uncovered.delete(cellKey(x, y)) || covers;
    }
    if (!covers) continue;
    const long: 'x' | 'y' = r.x1 - r.x0 >= r.y1 - r.y0 ? 'x' : 'y';
    const turn = roof.turned && roof.style === 'gable';
    picked.push({ ...r, axis: turn ? (long === 'x' ? 'y' : 'x') : long });
  }
  return picked;
}

/** Height of the roof's highest point above the wall tops, in meters (for the camera, stats). */
export function roofRise(rects: RoofRect[], roof: Roof): number {
  const t = Math.tan((effectivePitch(roof) * Math.PI) / 180);
  let rise = 0;
  for (const r of rects) {
    const across = (r.axis === 'x' ? r.y1 - r.y0 : r.x1 - r.x0) * CELL_M;
    const along = (r.axis === 'x' ? r.x1 - r.x0 : r.y1 - r.y0) * CELL_M;
    const span = roof.style === 'shed' ? across : roof.style === 'hip' ? Math.min(across, along) / 2 : across / 2;
    rise = Math.max(rise, span * t);
  }
  return roof.style === 'flat' ? 0.45 : rise;
}

/** Plan-view lines (in cells) for drawing a roof on the blueprint: ridges and hips. */
export function roofLines(rects: RoofRect[], roof: Roof): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (const r of rects) {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    if (roof.style === 'gable') {
      if (r.axis === 'x') out.push([r.x0, cy, r.x1, cy]);
      else out.push([cx, r.y0, cx, r.y1]);
    } else if (roof.style === 'hip') {
      const s = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2;
      const [ax, ay, bx, by] = r.x1 - r.x0 >= r.y1 - r.y0 ? [r.x0 + s, cy, r.x1 - s, cy] : [cx, r.y0 + s, cx, r.y1 - s];
      out.push([ax, ay, bx, by]);
      out.push([r.x0, r.y0, ax, ay], [r.x0, r.y1, ax, ay], [r.x1, r.y0, bx, by], [r.x1, r.y1, bx, by]);
    } else if (roof.style === 'shed') {
      // The high edge.
      const high = shedHighAtStart(roof);
      if (r.axis === 'x') out.push([r.x0, high ? r.y0 : r.y1, r.x1, high ? r.y0 : r.y1]);
      else out.push([high ? r.x0 : r.x1, r.y0, high ? r.x0 : r.x1, r.y1]);
    }
  }
  return out;
}

/** Shed roofs are high on the north/west side unless turned. */
export const shedHighAtStart = (roof: Roof): boolean => !roof.turned;
