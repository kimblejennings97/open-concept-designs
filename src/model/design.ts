import {
  CELL_M,
  type Edge,
  type Orient,
  cellKey,
  edgeKey,
  edgeSides,
  parseCell,
  parseEdge,
} from './grid';
import { normalizeRoomData } from './rooms';
import { type Furniture, normalizeFurniture } from './furniture';
import { DEFAULT_ROOF, type Roof, normalizeRoof } from './roof';

// ---------------------------------------------------------------------------
// Openings (doors & windows)
// ---------------------------------------------------------------------------

export type OpeningKind = 'door' | 'double-door' | 'window';

export interface OpeningSpec {
  label: string;
  /** Allowed widths, in cells. */
  minLen: number;
  maxLen: number;
  defaultLen: number;
  exteriorOnly: boolean;
  isDoor: boolean;
}

export const OPENING_SPECS: Record<OpeningKind, OpeningSpec> = {
  door: { label: 'Door', minLen: 2, maxLen: 2, defaultLen: 2, exteriorOnly: false, isDoor: true },
  'double-door': { label: 'Double door', minLen: 4, maxLen: 4, defaultLen: 4, exteriorOnly: false, isDoor: true },
  window: { label: 'Window', minLen: 2, maxLen: 8, defaultLen: 3, exteriorOnly: true, isDoor: false },
};

/** An opening spans `len` consecutive edges starting at edge (o, x, y). */
export interface Opening {
  id: string;
  kind: OpeningKind;
  o: Orient;
  x: number;
  y: number;
  len: number;
  /** Doors: which side the leaf swings to. */
  flip: boolean;
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export interface Design {
  id: string;
  name: string;
  /** Lot size in cells. */
  lotW: number;
  lotH: number;
  /** Cell keys "x,y" covered by the building. */
  footprint: Set<string>;
  /** Edge keys that have a wall. */
  walls: Set<string>;
  /**
   * Interior edges marked as a transition: an open boundary between two rooms (e.g. an open
   * kitchen and living room). Rooms split there, but people walk straight through.
   */
  transitions: Set<string>;
  roof: Roof;
  openings: Opening[];
  /** Floor material id per cell. */
  floors: Map<string, string>;
  /** Wall finish id per wall side ("<edgeKey>/0|1", see rooms.ts). */
  wallFinishes: Map<string, string>;
  /** Room type id per anchor cell (see rooms.ts). */
  roomTypes: Map<string, string>;
  furniture: Furniture[];
  /** Client brief this design answers, if it is a job. */
  briefId?: string;
  /** Which game mode it belongs to (save slots are separate per mode). */
  mode?: DesignMode;
}

export type DesignMode = 'free' | 'career' | 'sandbox';

/** JSON form, used for saving, undo snapshots, and (later) export/import. */
export interface DesignFile {
  format: 'open-concept-design';
  version: 1;
  id: string;
  name: string;
  lot: { w: number; h: number };
  footprint: string[];
  walls: string[];
  transitions?: string[];
  roof?: Roof;
  openings: Opening[];
  floors?: Record<string, string>;
  wallFinishes?: Record<string, string>;
  roomTypes?: Record<string, string>;
  furniture?: Furniture[];
  briefId?: string;
  mode?: DesignMode;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDesign(name = 'Untitled design', lotW = 40, lotH = 30): Design {
  return {
    id: newId(),
    name,
    lotW,
    lotH,
    footprint: new Set(),
    walls: new Set(),
    transitions: new Set(),
    roof: { ...DEFAULT_ROOF },
    openings: [],
    floors: new Map(),
    wallFinishes: new Map(),
    roomTypes: new Map(),
    furniture: [],
  };
}

const sortedRecord = (m: Map<string, string>): Record<string, string> =>
  Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function stringMap(v: unknown): Map<string, string> {
  if (!v || typeof v !== 'object') return new Map();
  return new Map(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export function serialize(d: Design): DesignFile {
  return {
    format: 'open-concept-design',
    version: 1,
    id: d.id,
    name: d.name,
    lot: { w: d.lotW, h: d.lotH },
    footprint: [...d.footprint].sort(),
    walls: [...d.walls].sort(),
    transitions: [...d.transitions].sort(),
    roof: { ...d.roof },
    openings: d.openings.map((o) => ({ ...o })),
    floors: sortedRecord(d.floors),
    wallFinishes: sortedRecord(d.wallFinishes),
    roomTypes: sortedRecord(d.roomTypes),
    furniture: d.furniture.map((f) => ({ ...f })),
    ...(d.briefId ? { briefId: d.briefId } : {}),
    ...(d.mode ? { mode: d.mode } : {}),
  };
}

export function deserialize(raw: unknown): Design {
  const f = raw as Partial<DesignFile> | null;
  if (!f || f.format !== 'open-concept-design') throw new Error('Not an Open Concept Designs file');
  if (f.version !== 1) throw new Error(`Unsupported design version: ${String(f.version)}`);
  const w = f.lot?.w;
  const h = f.lot?.h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w! <= 0 || h! <= 0) throw new Error('Bad lot size');
  const d: Design = {
    id: typeof f.id === 'string' ? f.id : newId(),
    name: typeof f.name === 'string' ? f.name : 'Untitled design',
    lotW: w!,
    lotH: h!,
    footprint: new Set(Array.isArray(f.footprint) ? f.footprint : []),
    walls: new Set(Array.isArray(f.walls) ? f.walls : []),
    transitions: new Set(Array.isArray(f.transitions) ? f.transitions : []),
    roof: normalizeRoof(f.roof),
    openings: Array.isArray(f.openings) ? f.openings.map((o) => ({ ...o })) : [],
    floors: stringMap(f.floors),
    wallFinishes: stringMap(f.wallFinishes),
    roomTypes: stringMap(f.roomTypes),
    furniture: Array.isArray(f.furniture) ? f.furniture.map((x) => ({ ...x })) : [],
    briefId: typeof f.briefId === 'string' ? f.briefId : undefined,
    mode: f.mode === 'career' || f.mode === 'sandbox' || f.mode === 'free' ? f.mode : undefined,
  };
  normalize(d);
  return d;
}

export const snapshot = (d: Design): string => JSON.stringify(serialize(d));
export const restore = (s: string): Design => deserialize(JSON.parse(s));

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const cellInLot = (d: Design, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < d.lotW && y < d.lotH;

export function edgeInLot(d: Design, e: Edge): boolean {
  return e.o === 'h'
    ? e.x >= 0 && e.x < d.lotW && e.y >= 0 && e.y <= d.lotH
    : e.x >= 0 && e.x <= d.lotW && e.y >= 0 && e.y < d.lotH;
}

export type WallKind = 'exterior' | 'interior' | 'none';

/** Exterior = footprint on one side only; interior = both sides; none = no footprint (walls not allowed). */
export function wallKind(d: Design, key: string): WallKind {
  const [[ax, ay], [bx, by]] = edgeSides(parseEdge(key));
  const a = d.footprint.has(cellKey(ax, ay));
  const b = d.footprint.has(cellKey(bx, by));
  return a && b ? 'interior' : a || b ? 'exterior' : 'none';
}

export function openingEdges(op: Pick<Opening, 'o' | 'x' | 'y' | 'len'>): string[] {
  const out: string[] = [];
  for (let i = 0; i < op.len; i++) {
    out.push(op.o === 'h' ? edgeKey('h', op.x + i, op.y) : edgeKey('v', op.x, op.y + i));
  }
  return out;
}

export function openingOnEdge(d: Design, key: string): Opening | undefined {
  return d.openings.find((op) => openingEdges(op).includes(key));
}

/** Why an opening can't go here, or null if it can. */
export function openingProblem(d: Design, op: Opening, ignoreId?: string): string | null {
  const spec = OPENING_SPECS[op.kind];
  if (op.len < spec.minLen || op.len > spec.maxLen) return `${spec.label} width must be ${spec.minLen}–${spec.maxLen} cells`;
  const edges = openingEdges(op);
  for (const k of edges) {
    if (!edgeInLot(d, parseEdge(k))) return 'Outside the lot';
    if (!d.walls.has(k)) return `${spec.label}s go on a wall — draw the wall first`;
    if (spec.exteriorOnly && wallKind(d, k) !== 'exterior') return `${spec.label}s only go on exterior walls`;
  }
  const taken = new Set(
    d.openings.filter((o) => o.id !== op.id && o.id !== ignoreId).flatMap((o) => openingEdges(o)),
  );
  if (edges.some((k) => taken.has(k))) return 'Overlaps another door or window';
  return null;
}

export interface DesignStats {
  footprintM2: number;
  exteriorWallM: number;
  interiorWallM: number;
  transitionM: number;
  doors: number;
  windows: number;
}

export function stats(d: Design): DesignStats {
  let ext = 0;
  let int = 0;
  for (const k of d.walls) {
    if (wallKind(d, k) === 'exterior') ext++;
    else int++;
  }
  return {
    footprintM2: d.footprint.size * CELL_M * CELL_M,
    exteriorWallM: ext * CELL_M,
    interiorWallM: int * CELL_M,
    transitionM: d.transitions.size * CELL_M,
    doors: d.openings.filter((o) => OPENING_SPECS[o.kind].isDoor).length,
    windows: d.openings.filter((o) => !OPENING_SPECS[o.kind].isDoor).length,
  };
}

// ---------------------------------------------------------------------------
// Mutations. Each returns true if the design changed.
// ---------------------------------------------------------------------------

/** Drop walls with no footprint beside them and openings that are no longer valid. */
export function normalize(d: Design): void {
  for (const k of [...d.walls]) {
    if (!edgeInLot(d, parseEdge(k)) || wallKind(d, k) === 'none') d.walls.delete(k);
  }
  // Transitions only make sense between two footprint cells with no wall.
  for (const k of [...d.transitions]) {
    if (!edgeInLot(d, parseEdge(k)) || wallKind(d, k) !== 'interior' || d.walls.has(k)) d.transitions.delete(k);
  }
  for (const k of [...d.footprint]) {
    const [x, y] = parseCell(k);
    if (!cellInLot(d, x, y)) d.footprint.delete(k);
  }
  const kept: Opening[] = [];
  for (const op of d.openings) {
    // Check against already-kept openings only, so of two overlapping openings the first survives.
    const probe: Design = { ...d, openings: kept };
    if (openingProblem(probe, op) === null) kept.push(op);
  }
  d.openings = kept;
  normalizeRoomData(d);
  normalizeFurniture(d);
}

/** Fill (add) or clear (remove) the rectangle of cells between two corners, inclusive. */
export function paintFootprint(d: Design, x0: number, y0: number, x1: number, y1: number, add: boolean): boolean {
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(d.lotW - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(d.lotH - 1, Math.max(y0, y1));
  let changed = false;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const k = cellKey(x, y);
      if (add && !d.footprint.has(k)) {
        d.footprint.add(k);
        changed = true;
      } else if (!add && d.footprint.has(k)) {
        d.footprint.delete(k);
        changed = true;
      }
    }
  }
  if (changed) normalize(d);
  return changed;
}

/** Add walls on the given edges; edges with no footprint beside them are skipped. */
export function addWalls(d: Design, keys: string[]): boolean {
  let changed = false;
  for (const k of keys) {
    if (d.walls.has(k) || !edgeInLot(d, parseEdge(k)) || wallKind(d, k) === 'none') continue;
    d.walls.add(k);
    d.transitions.delete(k);
    changed = true;
  }
  return changed;
}

/** Mark interior edges as transitions, replacing any wall (and doors on it) there. */
export function addTransitions(d: Design, keys: string[]): boolean {
  let changed = false;
  let removedWall = false;
  for (const k of keys) {
    if (d.transitions.has(k) || !edgeInLot(d, parseEdge(k)) || wallKind(d, k) !== 'interior') continue;
    d.transitions.add(k);
    removedWall = d.walls.delete(k) || removedWall;
    changed = true;
  }
  if (removedWall) normalize(d);
  else if (changed) normalizeRoomData(d);
  return changed;
}

export function removeTransitions(d: Design, keys: string[]): boolean {
  let changed = false;
  for (const k of keys) changed = d.transitions.delete(k) || changed;
  if (changed) normalizeRoomData(d);
  return changed;
}

export function setRoof(d: Design, patch: Partial<Roof>): boolean {
  const next = normalizeRoof({ ...d.roof, ...patch });
  if (JSON.stringify(next) === JSON.stringify(d.roof)) return false;
  d.roof = next;
  return true;
}

/** Remove walls (and any doors/windows on them). */
export function removeWalls(d: Design, keys: string[]): boolean {
  let changed = false;
  for (const k of keys) changed = d.walls.delete(k) || changed;
  if (changed) normalize(d);
  return changed;
}

/** Put a wall on every footprint edge that faces outside. */
export function encloseFootprint(d: Design): boolean {
  const keys: string[] = [];
  for (const k of d.footprint) {
    const [x, y] = parseCell(k);
    if (!d.footprint.has(cellKey(x, y - 1))) keys.push(edgeKey('h', x, y));
    if (!d.footprint.has(cellKey(x, y + 1))) keys.push(edgeKey('h', x, y + 1));
    if (!d.footprint.has(cellKey(x - 1, y))) keys.push(edgeKey('v', x, y));
    if (!d.footprint.has(cellKey(x + 1, y))) keys.push(edgeKey('v', x + 1, y));
  }
  return addWalls(d, keys);
}

export function addOpening(d: Design, op: Opening): boolean {
  if (openingProblem(d, op) !== null) return false;
  d.openings.push({ ...op });
  return true;
}

export function removeOpening(d: Design, id: string): boolean {
  const before = d.openings.length;
  d.openings = d.openings.filter((o) => o.id !== id);
  return d.openings.length !== before;
}
