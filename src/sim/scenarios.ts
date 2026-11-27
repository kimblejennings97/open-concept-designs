/**
 * Building-specific flow scenarios: turns a Design into a NavGrid and a crowd of agents,
 * runs the engine, and scores the result.
 *
 * This is the only sim file that knows about the building model. The engine, A* and
 * NavGrid stay generic (no model, UI or Three.js imports) so they can be reused.
 */
import { type BuildingType, CATALOG, catalogItem, roomType } from '../data/catalog';
import { type Design, OPENING_SPECS, openingEdges, wallKind } from '../model/design';
import { footprintCells } from '../model/furniture';
import { cellKey, parseCell, parseEdge, edgeSides, CELL_M } from '../model/grid';
import type { RoomMap } from '../model/rooms';
import { fmtLen } from '../model/units';
import { type AgentSpec, type Goal, type SimResult, runSim } from './engine';
import { type NavGrid, cellIndex, createNavGrid, walkable } from './navgrid';

export type SimBuilding = BuildingType;

/** What each scenario acts out, for the sim panel. */
export const SIM_SCENARIOS: Record<SimBuilding, string> = {
  house: 'House: morning rush',
  store: 'Store: shoppers',
  restaurant: 'Restaurant: dinner service',
  club: 'Nightclub: Saturday night',
  apartment: 'Apartments: morning rush',
};

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

/**
 * Guess the building from its rooms and fixtures: rooms and pieces that belong to only one
 * kind of building vote for it. Several kitchens (or mailboxes) make it an apartment building.
 */
export function inferBuilding(d: Design, rooms: RoomMap): SimBuilding {
  const votes = new Map<SimBuilding, number>();
  const vote = (types: readonly BuildingType[] | undefined, weight: number) => {
    if (types?.length === 1) votes.set(types[0], (votes.get(types[0]) ?? 0) + weight);
  };
  for (const r of rooms.rooms) vote(roomType(r.type)?.buildingTypes, 3);
  for (const f of d.furniture) {
    const item = catalogItem(f.item);
    if (item?.category === 'Store shelving' || item?.category === 'Grocery' || item?.id === 'checkout-counter') vote(['store'], 2);
    else if (item?.id === 'dj-booth' || item?.id === 'bar-counter') vote(['club'], 2);
    else if (item?.category === 'Restaurant seating' || item?.category === 'Commercial kitchen') vote(['restaurant'], 2);
    else if (item?.category === 'Apartment building') vote(['apartment'], 4);
  }
  const kitchens = rooms.rooms.filter((r) => r.type === 'kitchen').length;
  if (kitchens >= 2) votes.set('apartment', (votes.get('apartment') ?? 0) + 4 * kitchens);
  let best: SimBuilding = 'house';
  let top = 0;
  for (const [b, n] of votes) if (n > top) [best, top] = [b, n];
  return best;
}

/** Walkable cells spread over every room of a type (to wander around a dance floor, say). */
function spreadCells(g: NavGrid, rooms: RoomMap, type: string, max = 24): number[] {
  const out: number[] = [];
  for (const r of rooms.rooms) {
    if (r.type !== type) continue;
    const free = r.cells.map(parseCell).filter(([x, y]) => walkable(g, x, y));
    const step = Math.max(1, Math.floor(free.length / max));
    for (let i = 0; i < free.length; i += step) out.push(cellIndex(g, free[i][0], free[i][1]));
  }
  return out;
}

const pick = <T>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

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
  const all = standCells(d, g, rooms, furnId);
  return all.length ? all[0].cell : null;
}

/** Every walkable cell touching a piece (same room), front side first, then nearest the middle. */
function standCells(d: Design, g: NavGrid, rooms: RoomMap, furnId: string): Array<{ cell: number; front: boolean }> {
  const f = d.furniture.find((o) => o.id === furnId);
  const item = f && catalogItem(f.item);
  if (!f || !item) return [];
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
  return candidates.map(([x, y, rank]) => ({ cell: cellIndex(g, x, y), front: rank < 100 }));
}

/** Spots along the front of every matching piece (a bar has room for several people at once). */
function frontCells(d: Design, g: NavGrid, rooms: RoomMap, match: (itemId: string) => boolean): number[] {
  const out: number[] = [];
  for (const f of d.furniture) {
    if (!match(f.item)) continue;
    const spots = standCells(d, g, rooms, f.id);
    const front = spots.filter((s) => s.front);
    for (const s of front.length ? front : spots.slice(0, 1)) out.push(s.cell);
  }
  return out;
}

/** A few random cells from a list, so people spread out instead of all aiming for one spot. */
const sample = (cells: number[], n: number, rand: () => number): number[] =>
  Array.from({ length: Math.min(n, cells.length) }, () => cells[Math.floor(rand() * cells.length)]);

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
function housePlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number, apartments = false): Plan {
  const issues: FlowIssue[] = [];
  const starts: number[] = [];
  for (const f of d.furniture) {
    const people = f.item === 'bed-double' || f.item === 'bed-king' ? 2 : f.item === 'bed-single' ? 1 : 0;
    const c = people ? accessCell(d, g, rooms, f.id) : null;
    for (let i = 0; i < people && c !== null; i++) starts.push(c);
  }
  if (!starts.length) {
    const bedrooms = roomCells(g, rooms, 'bedroom');
    for (const c of bedrooms) starts.push(c);
    if (bedrooms.length) issues.push({ text: 'No beds yet, so residents start in the middle of each bedroom.', severity: 5 });
  }
  if (!starts.length) {
    issues.push({ text: `No bedrooms: add a bedroom so the ${apartments ? 'building' : 'house'} has residents.`, severity: 60 });
    return { specs: [], issues };
  }

  let bathrooms = accessCells(d, g, rooms, (item, rt) => rt === 'bathroom' && (item === 'toilet' || item === 'vanity'));
  if (!bathrooms.length) bathrooms = roomCells(g, rooms, 'bathroom');
  let kitchen = accessCells(d, g, rooms, (item, rt) => rt === 'kitchen' && ['fridge', 'stove', 'counter', 'kitchen-sink'].includes(item));
  if (!kitchen.length) kitchen = roomCells(g, rooms, 'kitchen');
  if (!bathrooms.length) issues.push({ text: 'No bathroom: residents have nowhere to get ready.', severity: 50 });
  if (!kitchen.length) issues.push({ text: 'No kitchen: residents skip breakfast.', severity: 30 });
  const mail = apartments ? accessCells(d, g, rooms, (item) => item === 'mailboxes' || item === 'package-lockers') : [];
  if (apartments && !mail.length) issues.push({ text: 'No mailboxes: residents can’t pick up their mail on the way out.', severity: 10 });

  const specs = starts.map((start, i) => {
    const goals: Goal[] = [];
    if (bathrooms.length) goals.push({ cells: bathrooms, dwell: 20 + rand() * 15, label: 'the bathroom' });
    if (kitchen.length) goals.push({ cells: kitchen, dwell: 12 + rand() * 10, label: 'the kitchen' });
    if (mail.length && rand() < 0.5) goals.push({ cells: mail, dwell: 6 + rand() * 6, label: 'the mailboxes' });
    goals.push({ cells: exits, dwell: 0, label: apartments ? 'the main entrance' : 'the front door' });
    return { kind: 'resident', start, startTime: i * (apartments ? 3 : 4) + rand() * 6, goals };
  });
  return { specs, issues };
}

/** Shoppers come in, pick up 1–4 items, pay, and leave. */
function storePlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number): Plan {
  const issues: FlowIssue[] = [];
  const shelfItems = new Set(
    CATALOG.filter((i) => i.category === 'Store shelving' || (i.category === 'Grocery' && i.id !== 'self-checkout' && i.id !== 'cart-bay') || i.id === 'coffee-station').map((i) => i.id),
  );
  const shelves = accessCells(d, g, rooms, (item) => shelfItems.has(item));
  const checkouts = accessCells(d, g, rooms, (item) => item === 'checkout-counter' || item === 'self-checkout');
  if (!shelves.length) issues.push({ text: 'No shelves or coolers: shoppers have nothing to buy.', severity: 50 });
  if (!checkouts.length) issues.push({ text: 'No checkout counter: shoppers can’t pay.', severity: 50 });

  const areaM2 = d.footprint.size * CELL_M * CELL_M;
  const big = areaM2 > 300;
  const shoppers = Math.round(Math.min(60, Math.max(24, areaM2 / 12)));
  const gap = big ? 5 : 8;
  const specs: AgentSpec[] = [];
  for (let i = 0; i < shoppers; i++) {
    const goals: Goal[] = [];
    const count = (big ? 2 : 1) + Math.floor(rand() * (big ? 5 : 4));
    for (let k = 0; k < count && shelves.length; k++) {
      goals.push({ cells: [shelves[Math.floor(rand() * shelves.length)]], dwell: 3 + rand() * 4, label: 'the shelves' });
    }
    if (checkouts.length) goals.push({ cells: checkouts, dwell: 8 + rand() * 6, label: 'the checkout' });
    goals.push({ cells: exits, dwell: 0, label: 'the exit' });
    const start = exits[Math.floor(rand() * exits.length)];
    specs.push({ kind: 'shopper', start, startTime: i * gap + rand() * 6, goals });
  }
  return { specs, issues };
}

/** Dinner service: parties arrive, check in, sit and eat; servers run plates from the kitchen. */
function restaurantPlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number): Plan {
  const issues: FlowIssue[] = [];
  const seatItems = new Set(CATALOG.filter((i) => i.category === 'Restaurant seating' && i.id !== 'host-stand').map((i) => i.id));
  seatItems.add('high-top');
  seatItems.add('dining-table');
  const tables = d.furniture.filter((f) => seatItems.has(f.item)).map((f) => standCells(d, g, rooms, f.id).map((s) => s.cell)).filter((c) => c.length);
  const seats = tables.map((t) => t[0]);
  const host = accessCells(d, g, rooms, (item) => item === 'host-stand');
  let kitchen = accessCells(d, g, rooms, (item) => ['pro-range', 'prep-table', 'dish-station', 'walk-in'].includes(item));
  if (!kitchen.length) kitchen = roomCells(g, rooms, 'pro-kitchen');
  const restrooms = accessCells(d, g, rooms, (item, rt) => rt === 'restroom' && (item === 'toilet' || item === 'vanity'));
  if (!seats.length) issues.push({ text: 'No tables: diners have nowhere to sit.', severity: 50 });
  if (!kitchen.length) issues.push({ text: 'No commercial kitchen: nobody can cook the food.', severity: 50 });
  if (!restrooms.length) issues.push({ text: 'No restroom with a toilet for diners.', severity: 20 });
  if (!host.length) issues.push({ text: 'No host stand: arriving diners wander off to find a table.', severity: 6 });
  if (!seats.length || !kitchen.length) return { specs: [], issues };

  const specs: AgentSpec[] = [];
  const parties = Math.min(tables.length, 16);
  for (let i = 0; i < parties; i++) {
    const table = tables[i % tables.length];
    const size = Math.min(table.length, 2 + Math.floor(rand() * 2));
    const startTime = i * 14 + rand() * 8;
    for (let k = 0; k < size; k++) {
      const goals: Goal[] = [];
      if (host.length && k === 0) goals.push({ cells: host, dwell: 4 + rand() * 3, label: 'the host stand' });
      goals.push({ cells: [table[k]], dwell: 70 + rand() * 50, label: 'their table', passable: true });
      if (restrooms.length && rand() < 0.3) goals.push({ cells: restrooms, dwell: 25 + rand() * 15, label: 'the restroom' });
      goals.push({ cells: exits, dwell: 0, label: 'the exit' });
      specs.push({ kind: 'diner', start: pick(exits, rand), startTime: startTime + k * 1.5, goals });
    }
  }
  const servers = Math.max(2, Math.ceil(parties / 5));
  for (let i = 0; i < servers; i++) {
    const goals: Goal[] = [];
    for (let k = 0; k < 6; k++) {
      goals.push({ cells: kitchen, dwell: 8 + rand() * 6, label: 'the kitchen' });
      goals.push({ cells: pick(tables, rand), dwell: 4 + rand() * 3, label: 'a table' });
    }
    goals.push({ cells: kitchen, dwell: 0, label: 'the kitchen' });
    specs.push({ kind: 'server', start: pick(kitchen, rand), startTime: 20 + i * 10, goals });
  }
  return { specs, issues };
}

/** Saturday night: guests drop their coats, hit the bar, dance, and head home. */
function clubPlan(d: Design, g: NavGrid, rooms: RoomMap, exits: number[], rand: () => number): Plan {
  const issues: FlowIssue[] = [];
  const bars = frontCells(d, g, rooms, (item) => item === 'bar-counter');
  const dance = spreadCells(g, rooms, 'dance-floor', 60);
  const coats = frontCells(d, g, rooms, (item) => item === 'coat-counter');
  const lounge = [...accessCells(d, g, rooms, (item) => item === 'lounge-sofa'), ...spreadCells(g, rooms, 'lounge', 8)];
  const restrooms = accessCells(d, g, rooms, (item, rt) => rt === 'restroom' && (item === 'toilet' || item === 'vanity'));
  if (!bars.length) issues.push({ text: 'No bar counter: guests can’t get a drink.', severity: 45 });
  if (!dance.length) issues.push({ text: 'No dance floor: mark a room as a dance floor.', severity: 45 });
  if (!restrooms.length) issues.push({ text: 'No restroom with a toilet for guests.', severity: 25 });
  if (!coats.length) issues.push({ text: 'No coat check: guests keep their coats on all night.', severity: 5 });
  if (!bars.length && !dance.length) return { specs: [], issues };

  const areaM2 = d.footprint.size * CELL_M * CELL_M;
  const guests = Math.round(Math.min(70, Math.max(30, areaM2 / 7)));
  const specs: AgentSpec[] = [];
  for (let i = 0; i < guests; i++) {
    const goals: Goal[] = [];
    if (coats.length) goals.push({ cells: coats, dwell: 5 + rand() * 4, label: 'the coat check' });
    if (bars.length) goals.push({ cells: bars, dwell: 10 + rand() * 8, label: 'the bar' });
    if (dance.length) goals.push({ cells: sample(dance, 6, rand), dwell: 40 + rand() * 50, label: 'the dance floor', passable: true });
    if (lounge.length && rand() < 0.3) goals.push({ cells: sample(lounge, 4, rand), dwell: 30 + rand() * 30, label: 'the lounge', passable: true });
    if (restrooms.length && rand() < 0.5) goals.push({ cells: restrooms, dwell: 20 + rand() * 15, label: 'the restroom' });
    if (bars.length && rand() < 0.5) goals.push({ cells: bars, dwell: 10 + rand() * 8, label: 'the bar' });
    if (dance.length && rand() < 0.5) goals.push({ cells: sample(dance, 6, rand), dwell: 30 + rand() * 30, label: 'the dance floor', passable: true });
    if (coats.length) goals.push({ cells: coats, dwell: 4 + rand() * 3, label: 'the coat check' });
    goals.push({ cells: exits, dwell: 0, label: 'the exit' });
    specs.push({ kind: 'guest', start: pick(exits, rand), startTime: i * 4 + rand() * 4, goals });
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
  const plan =
    building === 'store'
      ? storePlan(d, g, rooms, exits, rand)
      : building === 'restaurant'
        ? restaurantPlan(d, g, rooms, exits, rand)
        : building === 'club'
          ? clubPlan(d, g, rooms, exits, rand)
          : housePlan(d, g, rooms, exits, rand, building === 'apartment');
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
  const refCells = 2.2 * Math.sqrt(d.footprint.size) * ({ house: 1, store: 1.6, restaurant: 1.4, club: 2, apartment: 0.9 } as const)[building];
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
