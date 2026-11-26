/**
 * Room detection. A room is a connected group of footprint cells you can reach
 * without crossing a wall (doors and windows count as wall for this). A room is
 * "enclosed" when every edge between it and the outside has a wall.
 *
 * Room data is stored so it survives edits:
 *   - floor material per cell (splitting a room keeps both halves' floors),
 *   - wall finish per wall *side* ("<edgeKey>/0" = above/left face, "/1" = below/right face),
 *   - room type on an "anchor" cell; a room takes the type of the first anchor inside it.
 */
import type { Design } from './design';
import { CELL_M, type CellXY, cellKey, edgeKey, edgeSides, parseCell, parseEdge } from './grid';

export type Side = 0 | 1;

export interface Room {
  /** Cell keys, sorted. */
  cells: string[];
  enclosed: boolean;
  areaM2: number;
  /** A cell near the middle of the room, for labels. */
  labelCell: CellXY;
  /** Wall-side keys facing into this room. */
  wallSides: string[];
  /** Every edge on the room's outline (walls and open edges), for drawing a selection outline. */
  boundary: string[];
  /** Room type id, if assigned. */
  type?: string;
}

export interface RoomMap {
  rooms: Room[];
  byCell: Map<string, Room>;
}

export const sideKey = (edge: string, side: Side): string => `${edge}/${side}`;

export function parseSideKey(key: string): { edge: string; side: Side } {
  const i = key.lastIndexOf('/');
  return { edge: key.slice(0, i), side: Number(key.slice(i + 1)) as Side };
}

/** The four edges around a cell, the neighbor across each, and which side of the edge this cell is on. */
function around(x: number, y: number): Array<{ edge: string; nx: number; ny: number; side: Side }> {
  return [
    { edge: edgeKey('h', x, y), nx: x, ny: y - 1, side: 1 },
    { edge: edgeKey('h', x, y + 1), nx: x, ny: y + 1, side: 0 },
    { edge: edgeKey('v', x, y), nx: x - 1, ny: y, side: 1 },
    { edge: edgeKey('v', x + 1, y), nx: x + 1, ny: y, side: 0 },
  ];
}

export function findRooms(d: Design): RoomMap {
  const rooms: Room[] = [];
  const byCell = new Map<string, Room>();
  const visited = new Set<string>();

  for (const start of [...d.footprint].sort()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const cells: string[] = [];
    const wallSides: string[] = [];
    const boundary: string[] = [];
    let enclosed = true;
    const queue = [start];
    while (queue.length) {
      const k = queue.pop()!;
      cells.push(k);
      const [x, y] = parseCell(k);
      for (const { edge, nx, ny, side } of around(x, y)) {
        const nk = cellKey(nx, ny);
        if (d.walls.has(edge)) {
          wallSides.push(sideKey(edge, side));
          boundary.push(edge);
        } else if (!d.footprint.has(nk)) {
          enclosed = false;
          boundary.push(edge);
        } else if (!visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }
    cells.sort();

    let sx = 0;
    let sy = 0;
    for (const k of cells) {
      const [x, y] = parseCell(k);
      sx += x + 0.5;
      sy += y + 0.5;
    }
    const cx = sx / cells.length;
    const cy = sy / cells.length;
    let labelCell: CellXY = parseCell(cells[0]);
    let best = Infinity;
    for (const k of cells) {
      const [x, y] = parseCell(k);
      const dist = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (dist < best) {
        best = dist;
        labelCell = [x, y];
      }
    }

    const anchor = cells.find((k) => d.roomTypes.has(k));
    const room: Room = {
      cells,
      enclosed,
      areaM2: cells.length * CELL_M * CELL_M,
      labelCell,
      wallSides,
      boundary,
      type: anchor ? d.roomTypes.get(anchor) : undefined,
    };
    rooms.push(room);
    for (const k of cells) byCell.set(k, room);
  }
  return { rooms, byCell };
}

/** Drop room data that no longer has anything under it. Called from normalize(). */
export function normalizeRoomData(d: Design): void {
  for (const k of [...d.floors.keys()]) if (!d.footprint.has(k)) d.floors.delete(k);

  for (const k of [...d.wallFinishes.keys()]) {
    const { edge, side } = parseSideKey(k);
    const [cx, cy] = edgeSides(parseEdge(edge))[side];
    if (!d.walls.has(edge) || !d.footprint.has(cellKey(cx, cy))) d.wallFinishes.delete(k);
  }

  for (const k of [...d.roomTypes.keys()]) if (!d.footprint.has(k)) d.roomTypes.delete(k);
  if (d.roomTypes.size > 1) {
    // When rooms merge, keep only the first anchor in each room.
    for (const room of findRooms(d).rooms) {
      let kept = false;
      for (const k of room.cells) {
        if (!d.roomTypes.has(k)) continue;
        if (kept) d.roomTypes.delete(k);
        kept = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Room edits. Each returns true if the design changed.
// ---------------------------------------------------------------------------

export function setRoomType(d: Design, room: Room, type: string | null): boolean {
  if ((room.type ?? null) === type) return false;
  for (const k of room.cells) d.roomTypes.delete(k);
  if (type) d.roomTypes.set(room.labelCell.join(','), type);
  return true;
}

export function setRoomFloor(d: Design, room: Room, material: string | null): boolean {
  let changed = false;
  for (const k of room.cells) {
    if ((d.floors.get(k) ?? null) === material) continue;
    if (material) d.floors.set(k, material);
    else d.floors.delete(k);
    changed = true;
  }
  return changed;
}

export function setRoomWalls(d: Design, room: Room, finish: string | null): boolean {
  let changed = false;
  for (const k of room.wallSides) {
    if ((d.wallFinishes.get(k) ?? null) === finish) continue;
    if (finish) d.wallFinishes.set(k, finish);
    else d.wallFinishes.delete(k);
    changed = true;
  }
  return changed;
}

/** The single floor material / wall finish used across a room, "mixed", or null if none. */
export function roomFloor(d: Design, room: Room): string | null | 'mixed' {
  return uniform(room.cells.map((k) => d.floors.get(k) ?? null));
}

export function roomWalls(d: Design, room: Room): string | null | 'mixed' {
  return uniform(room.wallSides.map((k) => d.wallFinishes.get(k) ?? null));
}

function uniform(values: Array<string | null>): string | null | 'mixed' {
  if (values.length === 0) return null;
  return values.every((v) => v === values[0]) ? values[0] : 'mixed';
}
