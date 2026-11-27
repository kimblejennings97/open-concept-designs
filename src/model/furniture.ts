/**
 * Furniture placement and rules.
 *
 * An item's footprint is w×h cells with its front facing down (+y) at rotation 0.
 * Each rotation step turns it 90° clockwise. A placed piece's (x, y) is the top-left
 * cell of its rotated footprint.
 *
 * Errors block placement (outside the building, across a wall, overlapping something
 * on the same layer). Warnings are allowed but flagged: blocked clearance, in a door's
 * swing, not backed against a wall, unusual room.
 */
import { type CatalogItem, catalogItem, roomType } from '../data/catalog';
import type { Design } from './design';
import { cellKey, edgeKey } from './grid';
import { type Room, type RoomMap, openNeighbors } from './rooms';

export type Rotation = 0 | 1 | 2 | 3;

export interface Furniture {
  id: string;
  item: string;
  x: number;
  y: number;
  rot: Rotation;
}

/** World sides, clockwise from the top. */
const TOP = 0;
const BOTTOM = 2;
const LEFT = 3;

export function rotatedSize(item: CatalogItem, rot: Rotation): { w: number; h: number } {
  return rot % 2 === 0 ? { w: item.w, h: item.h } : { w: item.h, h: item.w };
}

/** Clearance depth per world side [top, right, bottom, left]. */
export function worldClearance(item: CatalogItem, rot: Rotation): [number, number, number, number] {
  const c = item.clearance;
  // At rotation 0: back is on top, front on the bottom.
  const local: [number, number, number, number] = [c.back, c.right, c.front, c.left];
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) out[(i + rot) % 4] = local[i];
  return out;
}

/** The world side the item's back faces. */
export const backSide = (rot: Rotation): number => (TOP + rot) % 4;

export function footprintCells(item: CatalogItem, f: Pick<Furniture, 'x' | 'y' | 'rot'>): string[] {
  const { w, h } = rotatedSize(item, f.rot);
  const out: string[] = [];
  for (let y = f.y; y < f.y + h; y++) for (let x = f.x; x < f.x + w; x++) out.push(cellKey(x, y));
  return out;
}

export function clearanceCells(item: CatalogItem, f: Pick<Furniture, 'x' | 'y' | 'rot'>): string[] {
  const { w, h } = rotatedSize(item, f.rot);
  const [ct, cr, cb, cl] = worldClearance(item, f.rot);
  const out: string[] = [];
  const band = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(cellKey(x, y));
  };
  band(f.x, f.y - ct, f.x + w, f.y); // top
  band(f.x + w, f.y, f.x + w + cr, f.y + h); // right
  band(f.x, f.y + h, f.x + w, f.y + h + cb); // bottom
  band(f.x - cl, f.y, f.x, f.y + h); // left
  return out;
}

/** Edge keys along one side of the piece's footprint. */
export function sideEdges(item: CatalogItem, f: Pick<Furniture, 'x' | 'y' | 'rot'>, side: number): string[] {
  const { w, h } = rotatedSize(item, f.rot);
  const out: string[] = [];
  if (side === TOP || side === BOTTOM) {
    const y = side === TOP ? f.y : f.y + h;
    for (let x = f.x; x < f.x + w; x++) out.push(edgeKey('h', x, y));
  } else {
    const x = side === LEFT ? f.x : f.x + w;
    for (let y = f.y; y < f.y + h; y++) out.push(edgeKey('v', x, y));
  }
  return out;
}

/** Edges strictly inside the footprint (between two of its cells). */
function innerEdges(item: CatalogItem, f: Pick<Furniture, 'x' | 'y' | 'rot'>): string[] {
  const { w, h } = rotatedSize(item, f.rot);
  const out: string[] = [];
  for (let y = f.y; y < f.y + h; y++) for (let x = f.x + 1; x < f.x + w; x++) out.push(edgeKey('v', x, y));
  for (let y = f.y + 1; y < f.y + h; y++) for (let x = f.x; x < f.x + w; x++) out.push(edgeKey('h', x, y));
  return out;
}

/** Cells a door leaf sweeps through. */
export function doorSwingCells(d: Design): Set<string> {
  const out = new Set<string>();
  for (const op of d.openings) {
    if (op.kind === 'window') continue;
    const side = op.flip ? -1 : 1;
    for (let i = 0; i < op.len; i++) {
      for (let j = 0; j < op.len; j++) {
        // j steps away from the wall on the swing side.
        const depth = side > 0 ? j : -1 - j;
        out.add(op.o === 'h' ? cellKey(op.x + i, op.y + depth) : cellKey(op.x + depth, op.y + i));
      }
    }
  }
  return out;
}

export interface FurnitureCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Check a piece against the design. `ignoreId` skips a piece (the one being moved).
 * Pass precomputed rooms/door swings when checking many pieces.
 */
export function checkFurniture(
  d: Design,
  f: Furniture,
  rooms: RoomMap,
  swing: Set<string> = doorSwingCells(d),
  ignoreId: string = f.id,
): FurnitureCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const item = catalogItem(f.item);
  if (!item) return { errors: ['Unknown item'], warnings };

  const cells = footprintCells(item, f);
  if (cells.some((k) => !d.footprint.has(k))) {
    errors.push('Must be inside the building');
    return { errors, warnings };
  }
  const room = rooms.byCell.get(cells[0]);
  // A piece may straddle a transition (a rug across an open kitchen and living room), not a wall.
  const space = new Set<Room | undefined>([room, ...(room ? openNeighbors(rooms, room) : [])]);
  const touched = new Set(cells.map((k) => rooms.byCell.get(k)));
  if ([...touched].some((r) => !space.has(r)) || innerEdges(item, f).some((k) => d.walls.has(k))) {
    errors.push('Crosses a wall');
  }

  const others = d.furniture.filter((o) => o.id !== ignoreId);
  const occupied = new Set<string>();
  const blocking = new Set<string>();
  for (const o of others) {
    const oi = catalogItem(o.item);
    if (!oi) continue;
    const oc = footprintCells(oi, o);
    if (oi.layer === item.layer) for (const k of oc) occupied.add(k);
    if (oi.layer === 'object') for (const k of oc) blocking.add(k);
  }
  if (cells.some((k) => occupied.has(k))) errors.push('Overlaps another item');

  const back = sideEdges(item, f, backSide(f.rot));
  const backed = back.every((k) => d.walls.has(k));
  if (item.layer === 'wall' && !backed) errors.push('Must hang on a wall');
  if (item.layer === 'object' && item.againstWall && !backed) warnings.push('Should be backed against a wall');

  if (item.layer === 'object') {
    const clear = clearanceCells(item, f);
    if (clear.some((k) => !space.has(rooms.byCell.get(k)) || !rooms.byCell.has(k) || blocking.has(k))) warnings.push('Clearance is blocked');
    if (cells.some((k) => swing.has(k))) warnings.push("In a door's swing");
  }

  const types = [...touched].map((r) => r?.type).filter((t): t is string => !!t);
  if (room?.type && item.roomTypes.length && !types.some((t) => item.roomTypes.includes(t))) {
    warnings.push(`Unusual in a ${roomType(room.type)?.name.toLowerCase() ?? 'room'}`);
  }
  return { errors, warnings };
}

/** Check every piece at once. */
export function checkAllFurniture(d: Design, rooms: RoomMap): Map<string, FurnitureCheck> {
  const swing = doorSwingCells(d);
  return new Map(d.furniture.map((f) => [f.id, checkFurniture(d, f, rooms, swing)]));
}

/** The topmost piece covering a cell (ceiling, then wall, object, floor). */
export function furnitureAt(d: Design, cell: string): Furniture | undefined {
  const order = { ceiling: 0, wall: 1, object: 2, floor: 3 } as const;
  let best: Furniture | undefined;
  let bestRank = 99;
  for (const f of d.furniture) {
    const item = catalogItem(f.item);
    if (!item || !footprintCells(item, f).includes(cell)) continue;
    const rank = order[item.layer];
    if (rank < bestRank) {
      best = f;
      bestRank = rank;
    }
  }
  return best;
}

/** Drop pieces that are no longer (even partly) inside the building. Called from normalize(). */
export function normalizeFurniture(d: Design): void {
  d.furniture = d.furniture.filter((f) => {
    const item = catalogItem(f.item);
    return !!item && footprintCells(item, f).every((k) => d.footprint.has(k));
  });
}

export function addFurniture(d: Design, f: Furniture): boolean {
  d.furniture.push({ ...f });
  return true;
}

export function removeFurniture(d: Design, id: string): boolean {
  const n = d.furniture.length;
  d.furniture = d.furniture.filter((f) => f.id !== id);
  return d.furniture.length !== n;
}

export function updateFurniture(d: Design, id: string, patch: Partial<Omit<Furniture, 'id'>>): boolean {
  const f = d.furniture.find((o) => o.id === id);
  if (!f) return false;
  const before = JSON.stringify(f);
  Object.assign(f, patch);
  return JSON.stringify(f) !== before;
}

export const nextRotation = (rot: Rotation): Rotation => ((rot + 1) % 4) as Rotation;
