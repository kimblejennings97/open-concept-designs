/**
 * Building-specific flow scenarios: turns a Design into a NavGrid and a crowd of agents,
 * runs the engine, and scores the result.
 *
 * This is the only sim file that knows about the building model. The engine, A* and
 * NavGrid stay generic (no model, UI or Three.js imports) so they can be reused.
 */
import { CATALOG, catalogItem, roomType } from '../data/catalog';
import { type Design, OPENING_SPECS, openingEdges, wallKind } from '../model/design';
import { footprintCells } from '../model/furniture';
import { cellKey, parseCell, parseEdge, edgeSides, CELL_M } from '../model/grid';
import type { RoomMap } from '../model/rooms';
import { fmtLen } from '../model/units';
import { type AgentSpec, type Goal, type SimResult, runSim } from './engine';
import { type NavGrid, cellIndex, createNavGrid, walkable } from './navgrid';

export type SimBuilding = 'house' | 'store';

export interface FlowIssue {
  text: string;
  /** Bigger = worse; used to pick the top issues. */
  severity: number;
  /** Cell index to point at, if any. */
  cell?: number;
}

export interface FlowReport {
  building: SimBuilding;
  /** 0–100. */
  score: number;
  people: number;
  finished: number;
  avgTripS: number;
  avgWaitS: number;
  avgWalkM: number;
  issues: FlowIssue[];
  grid: NavGrid;
  result: SimResult | null;
  /** Agent kinds, parallel to result outcomes (for coloring). */
  kinds: string[];
}

/** Store if it has store rooms or store fixtures, otherwise house. */
export function inferBuilding(d: Design, rooms: RoomMap): SimBuilding {
  if (rooms.rooms.some((r) => roomType(r.type)?.buildingTypes.includes('store') && r.type !== 'hallway')) return 'store';
  if (d.furniture.some((f) => catalogItem(f.item)?.category === 'Store shelving' || f.item === 'checkout-counter')) {
    return 'store';
  }
  return 'house';
}

/** NavGrid for the whole lot: outside is walkable, walls block except where there's a door. */
export function buildNavGrid(d: Design): NavGrid {
  const g = createNavGrid(d.lotW, d.lotH);
  const doorEdges = new Set(
    d.openings.filter((o) => OPENING_SPECS[o.kind].isDoor).flatMap((o) => openingEdges(o)),
  );
  for (const k of d.walls) {
    if (doorEdges.has(k)) continue;
    const e = parseEdge(k);
    if (e.o === 'h') g.hWall[e.y * g.w + e.x] = 1;
    else g.vWall[e.y * (g.w + 1) + e.x] = 1;
  }
  // Only solid furniture blocks; rugs, wall-hung and ceiling items don't.
  for (const f of d.furniture) {
    const item = catalogItem(f.item);
    if (item?.layer !== 'object') continue;
    for (const k of footprintCells(item, f)) {
      const [x, y] = parseCell(k);
      if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.blocked[cellIndex(g, x, y)] = 1;
    }
  }
  return g;
}

/** Outside cells just past each exterior door. */
export function entranceCells(d: Design, g: NavGrid): number[] {
  const out: number[] = [];
  for (const op of d.openings) {
    if (!OPENING_SPECS[op.kind].isDoor) continue;
    const edges = openingEdges(op);
    const mid = edges[Math.floor(edges.length / 2)];
    if (wallKind(d, mid) !== 'exterior') continue;
    for (const [x, y] of edgeSides(parseEdge(mid))) {
      if (!d.footprint.has(cellKey(x, y)) && walkable(g, x, y)) out.push(cellIndex(g, x, y));
    }
  }
  return out;
}

/** A walkable cell to stand at to use a piece of furniture: in front first, then any side. */
function accessCell(d: Design, g: NavGrid, rooms: RoomMap, furnId: string): number | null {
  const f = d.furniture.find((o) => o.id === furnId);
  const item = f && catalogItem(f.item);
  if (!f || !item) return null;
  const w = f.rot % 2 === 0 ? item.w : item.h;
  const h = f.rot % 2 === 0 ? item.h : item.w;
  const room = rooms.byCell.get(cellKey(f.x, f.y));
  const cx = f.x + w / 2;
  const cy = f.y + h / 2;
  // Front direction per rotation: down, left, up, right.
  const [fx, fy] = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ][f.rot];
  const candidates: Array<[number, number, number]> = [];
  for (let y = f.y - 1; y <= f.y + h; y++) {
    for (let x = f.x - 1; x <= f.x + w; x++) {
      const inside = x >= f.x && x < f.x + w && y >= f.y && y < f.y + h;
      const corner = (x < f.x || x >= f.x + w) && (y < f.y || y >= f.y + h);
      if (inside || corner || !walkable(g, x, y) || rooms.byCell.get(cellKey(x, y)) !== room) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // Prefer cells on the front side, then the ones nearest the middle.
      const front = dx * fx + dy * fy > 0 ? 0 : 100;
      candidates.push([x, y, front + Math.hypot(dx, dy)]);
    }
  }
  candidates.sort((a, b) => a[2] - b[2]);
  return candidates.length ? cellIndex(g, candidates[0][0], candidates[0][1]) : null;
}

/** Access cells for every piece matching a filter. */
function accessCells(d: Design, g: NavGrid, rooms: RoomMap, match: (itemId: string, roomTypeId?: string) => boolean) {
  const out: number[] = [];
  for (const f of d.furniture) {
    const room = rooms.byCell.get(cellKey(f.x, f.y));
    if (!match(f.item, room?.type)) continue;
    const c = accessCell(d, g, rooms, f.id);
    if (c !== null) out.push(c);
  }
  return out;
}

/** Walkable label cells of rooms of a type (fallback when a room has no fixtures). */
function roomCells(g: NavGrid, rooms: RoomMap, type: string): number[] {
  const out: number[] = [];
  for (const r of rooms.rooms) {
    if (r.type !== type) continue;
    const [x, y] = r.labelCell;
    if (walkable(g, x, y)) out.push(cellIndex(g, x, y));
    else {
      const free = r.cells.map(parseCell).find(([cx, cy]) => walkable(g, cx, cy));
      if (free) out.push(cellIndex(g, free[0], free[1]));
    }
  }
  return out;
}

/** Small seeded RNG (mulberry32) so a design always simulates the same way. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Plan {
  specs: AgentSpec[];
  issues: FlowIssue[];
}

/** Morning rush: everyone gets up, uses a bathroom, grabs breakfast, heads out. */
function housePlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number): Plan {
  const issues: FlowIssue[] = [];
  const starts: number[] = [];
  for (const f of d.furniture) {
    const people = f.item === 'bed-double' ? 2 : f.item === 'bed-single' ? 1 : 0;
    const c = people ? accessCell(d, g, rooms, f.id) : null;
    for (let i = 0; i < people && c !== null; i++) starts.push(c);
  }
  if (!starts.length) {
    const bedrooms = roomCells(g, rooms, 'bedroom');
    for (const c of bedrooms) starts.push(c);
    if (bedrooms.length) issues.push({ text: 'No beds yet, so residents start in the middle of each bedroom.', severity: 5 });
  }
  if (!starts.length) {
    issues.push({ text: 'No bedrooms: add a bedroom so the house has residents.', severity: 60 });
    return { specs: [], issues };
  }

  let bathrooms = accessCells(d, g, rooms, (item, rt) => rt === 'bathroom' && (item === 'toilet' || item === 'vanity'));
  if (!bathrooms.length) bathrooms = roomCells(g, rooms, 'bathroom');
  let kitchen = accessCells(d, g, rooms, (item, rt) => rt === 'kitchen' && ['fridge', 'stove', 'counter', 'kitchen-sink'].includes(item));
  if (!kitchen.length) kitchen = roomCells(g, rooms, 'kitchen');
  if (!bathrooms.length) issues.push({ text: 'No bathroom: residents have nowhere to get ready.', severity: 50 });
  if (!kitchen.length) issues.push({ text: 'No kitchen: residents skip breakfast.', severity: 30 });

  const specs = starts.map((start, i) => {
    const goals: Goal[] = [];
    if (bathrooms.length) goals.push({ cells: bathrooms, dwell: 20 + rand() * 15, label: 'the bathroom' });
    if (kitchen.length) goals.push({ cells: kitchen, dwell: 12 + rand() * 10, label: 'the kitchen' });
    goals.push({ cells: exits, dwell: 0, label: 'the front door' });
    return { kind: 'resident', start, startTime: i * 4 + rand() * 6, goals };
  });
  return { specs, issues };
}

/** Shoppers come in, pick up 1–4 items, pay, and leave. */
function storePlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number): Plan {
  const issues: FlowIssue[] = [];
  const shelfItems = new Set(
    CATALOG.filter((i) => i.category === 'Store shelving' || i.id === 'coffee-station').map((i) => i.id),
  );
  const shelves = accessCells(d, g, rooms, (item) => shelfItems.has(item));
  const checkouts = accessCells(d, g, rooms, (item) => item === 'checkout-counter');
  if (!shelves.length) issues.push({ text: 'No shelves or coolers: shoppers have nothing to buy.', severity: 50 });
  if (!checkouts.length) issues.push({ text: 'No checkout counter: shoppers can’t pay.', severity: 50 });

  const shoppers = 24;
  const specs: AgentSpec[] = [];
  for (let i = 0; i < shoppers; i++) {
    const goals: Goal[] = [];
    const count = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < count && shelves.length; k++) {
      goals.push({ cells: [shelves[Math.floor(rand() * shelves.length)]], dwell: 3 + rand() * 4, label: 'the shelves' });
    }
    if (checkouts.length) goals.push({ cells: checkouts, dwell: 8 + rand() * 6, label: 'the checkout' });
    goals.push({ cells: exits, dwell: 0, label: 'the exit' });
    const start = exits[Math.floor(rand() * exits.length)];
    specs.push({ kind: 'shopper', start, startTime: i * 8 + rand() * 6, goals });
  }
  return { specs, issues };
}

// ---------------------------------------------------------------------------
// Run + score
// ---------------------------------------------------------------------------

export function simulateFlow(d: Design, rooms: RoomMap, building: SimBuilding, seed = 1): FlowReport {
  const g = buildNavGrid(d);
  const empty = (issues: FlowIssue[]): FlowReport => ({
    building,
    score: 0,
    people: 0,
    finished: 0,
    avgTripS: 0,
    avgWaitS: 0,
    avgWalkM: 0,
    issues,
    grid: g,
    result: null,
    kinds: [],
  });

  if (d.footprint.size === 0) return empty([{ text: 'Nothing to simulate yet: paint a footprint first.', severity: 100 }]);
  const exits = entranceCells(d, g);
  if (!exits.length) return empty([{ text: 'No way in or out: add a door on an exterior wall.', severity: 100 }]);

  const rand = rng(seed);
  const plan = building === 'house' ? housePlan(d, g, rooms, exits, rand) : storePlan(d, g, rooms, exits, rand);
  if (!plan.specs.length) return { ...empty(plan.issues), building };

  const result = runSim(g, plan.specs);
  const outs = result.outcomes;
  const issues = [...plan.issues];
  const finished = outs.filter((o) => o.finished).length;
  const trip = (o: (typeof outs)[number]) => o.endTime - o.startTime;
  const avg = (f: (o: (typeof outs)[number]) => number) => outs.reduce((s, o) => s + f(o), 0) / outs.length;
  const avgTripS = avg(trip);
  const avgWaitS = avg((o) => o.waitTime);
  const avgWalkCells = avg((o) => o.walked);

  // Unreachable goals
  const unreachable = new Map<string, number>();
  for (const o of outs) for (const label of o.unreachable) unreachable.set(label, (unreachable.get(label) ?? 0) + 1);
  for (const [label, n] of unreachable) {
    issues.push({ text: `${n} ${n === 1 ? 'person' : 'people'} couldn’t reach ${label}. Check for blocked doorways.`, severity: 40 + n });
  }

  // Queues
  for (const [label, secs] of Object.entries(result.waitByLabel)) {
    if (secs < 10) continue;
    issues.push({ text: `People spent ${Math.round(secs)} s in total waiting on the way to ${label}.`, severity: Math.min(35, secs / 4) });
  }

  // Congestion hot spot
  let hot = -1;
  for (let i = 0; i < result.waitHeat.length; i++) if (hot < 0 || result.waitHeat[i] > result.waitHeat[hot]) hot = i;
  if (hot >= 0 && result.waitHeat[hot] >= 6) {
    const x = hot % g.w;
    const y = Math.floor(hot / g.w);
    const room = rooms.byCell.get(cellKey(x, y));
    const where = room ? roomType(room.type)?.name.toLowerCase() ?? 'unassigned room' : 'outside the door';
    issues.push({ text: `Bottleneck in the ${where}: people stood stuck there for ${Math.round(result.waitHeat[hot])} s.`, severity: Math.min(30, result.waitHeat[hot] / 2), cell: hot });
  }

  // Long walks, compared with a compact layout of the same size.
  const refCells = 2.2 * Math.sqrt(d.footprint.size) * (building === 'store' ? 1.6 : 1);
  if (avgWalkCells > refCells * 1.4) {
    issues.push({ text: `Long walks: each trip covers about ${fmtLen(Math.round(avgWalkCells * CELL_M))} on average.`, severity: 15 });
  }

  const totalTrip = outs.reduce((s, o) => s + trip(o), 0);
  const totalWait = outs.reduce((s, o) => s + o.waitTime, 0);
  const waitScore = 1 - Math.min(1, totalTrip > 0 ? (totalWait / totalTrip) * 2 : 0);
  const walkScore = Math.min(1, refCells / Math.max(1, avgWalkCells));
  const completion = finished / outs.length;
  const planPenalty = plan.issues.reduce((s, i) => s + (i.severity >= 30 ? 0.25 : 0), 0);
  const score = Math.round(100 * Math.max(0, completion * (0.6 * waitScore + 0.4 * walkScore) - planPenalty));

  issues.sort((a, b) => b.severity - a.severity);
  return {
    building,
    score,
    people: outs.length,
    finished,
    avgTripS,
    avgWaitS,
    avgWalkM: avgWalkCells * CELL_M,
    issues,
    grid: g,
    result,
    kinds: plan.specs.map((s) => s.kind),
  };
}
