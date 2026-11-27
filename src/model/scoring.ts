/**
 * Scores for a design: aesthetics, budget and brief match (flow comes from the sim).
 * Each returns 0–100 plus plain-language issues for the report card.
 */
import { type Brief, THEME_NAMES, catalogItem, floorMaterial, roofMaterial, roomType, wallFinish } from '../data/catalog';
import { type Design, openingEdges, wallKind } from './design';
import { CELL_M, cellKey, edgeSides, parseEdge } from './grid';
import { type Room, type RoomMap, openGroups, openNeighbors, roomFloor, roomWalls } from './rooms';
import { ROOF_STYLES } from './roof';
import { DOOR_STYLES, doorStyle, isDoor } from './doors';

export interface ScoreIssue {
  category: 'flow' | 'aesthetics' | 'budget' | 'brief';
  text: string;
  /** Bigger = worse. */
  severity: number;
}

export interface PartScore {
  score: number;
  issues: ScoreIssue[];
}

/** Rooms people spend time in, which should get daylight. */
const LIT_ROOMS = new Set(['bedroom', 'living', 'kitchen', 'dining', 'sales-floor', 'office']);

// ---------------------------------------------------------------------------
// Aesthetics
// ---------------------------------------------------------------------------

export interface AestheticsBreakdown extends PartScore {
  theme: string | null;
  themeShare: number;
  light: number;
  harmony: number;
  finish: number;
  decor: number;
  luxuryBonus: number;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** 1 = pleasing pair, lower = clashing. Neutrals go with anything; similar or opposite hues work. */
export function colorHarmony(a: string, b: string): number {
  const [ha, sa, la] = hexToHsl(a);
  const [hb, sb, lb] = hexToHsl(b);
  const neutral = (s: number, l: number) => s < 0.2 || l > 0.85 || l < 0.15;
  if (neutral(sa, la) || neutral(sb, lb)) return 1;
  const d = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb));
  if (d <= 45) return 1;
  if (d >= 150) return 0.9;
  return 0.55;
}

/** Window length (m) letting light into each room. */
function windowMeters(d: Design, rooms: RoomMap): Map<Room, number> {
  const out = new Map<Room, number>();
  for (const op of d.openings) {
    if (op.kind !== 'window') continue;
    for (const k of openingEdges(op)) {
      if (wallKind(d, k) !== 'exterior') continue;
      for (const [x, y] of edgeSides(parseEdge(k))) {
        const room = rooms.byCell.get(cellKey(x, y));
        if (room) out.set(room, (out.get(room) ?? 0) + CELL_M);
      }
    }
  }
  return out;
}

export function scoreAesthetics(d: Design, rooms: RoomMap, wantedTheme?: string): AestheticsBreakdown {
  const issues: ScoreIssue[] = [];
  const enclosed = rooms.rooms.filter((r) => r.enclosed);
  const empty: AestheticsBreakdown = {
    score: 0,
    issues: [{ category: 'aesthetics', text: 'No finished rooms to judge yet.', severity: 30 }],
    theme: wantedTheme ?? null,
    themeShare: 0,
    light: 0,
    harmony: 0,
    finish: 0,
    decor: 0,
    luxuryBonus: 0,
  };
  if (!enclosed.length) return empty;
  const nameOf = (r: Room) => (roomType(r.type)?.name ?? 'unassigned room').toLowerCase();

  // Theme: share of finishes and furniture carrying the theme tag.
  const tagSets: string[][] = [];
  for (const r of enclosed) {
    const f = floorMaterial(roomFloor(d, r) ?? undefined);
    const w = wallFinish(roomWalls(d, r) ?? undefined);
    if (f) tagSets.push(f.tags);
    if (w) tagSets.push(w.tags);
  }
  for (const f of d.furniture) {
    const item = catalogItem(f.item);
    if (item?.tags.length) tagSets.push(item.tags);
  }
  // The roof is the biggest thing anyone sees from the street: style and material both count.
  const roofMat = roofMaterial(d.roof.material);
  if (roofMat) tagSets.push(roofMat.tags);
  tagSets.push(ROOF_STYLES[d.roof.style].tags);
  for (const op of d.openings) if (isDoor(op)) tagSets.push(DOOR_STYLES[doorStyle(d, op)].tags);
  let theme = wantedTheme ?? null;
  if (!theme && tagSets.length) {
    const counts = new Map<string, number>();
    for (const tags of tagSets) for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    theme = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  const themeShare = tagSets.length && theme ? tagSets.filter((t) => t.includes(theme!)).length / tagSets.length : 0;
  const themeScore = Math.min(1, themeShare / 0.6);
  if (theme && tagSets.length >= 4 && themeShare < 0.45) {
    issues.push({
      category: 'aesthetics',
      text: `Mixed styles: only ${Math.round(themeShare * 100)}% of finishes and furniture fit the ${THEME_NAMES[theme] ?? theme} look.`,
      severity: 20 - themeShare * 20,
    });
  }

  // Daylight in rooms people use. Open-plan rooms share light across transitions.
  const win = windowMeters(d, rooms);
  const groupOf = new Map<Room, Room[]>();
  for (const g of openGroups(rooms)) for (const r of g) groupOf.set(r, g);
  const lightOf = (r: Room): number => {
    const own = (win.get(r) ?? 0) / Math.max(1, r.areaM2 / 10);
    const g = groupOf.get(r) ?? [r];
    const shared = g.reduce((s, x) => s + (win.get(x) ?? 0), 0) / Math.max(1, g.reduce((s, x) => s + x.areaM2, 0) / 10);
    return Math.min(1, Math.max(own, shared));
  };
  const lit = enclosed.filter((r) => r.type && LIT_ROOMS.has(r.type));
  let light = 1;
  if (lit.length) {
    light = lit.reduce((s, r) => s + lightOf(r), 0) / lit.length;
    const dark = lit.filter((r) => lightOf(r) === 0);
    if (dark.length) {
      issues.push({
        category: 'aesthetics',
        text: dark.length === 1 ? `The ${nameOf(dark[0])} has no windows.` : `${dark.length} rooms have no windows (${dark.map(nameOf).join(', ')}).`,
        severity: 12 + 4 * dark.length,
      });
    }
  }

  // Finish completeness and floor/wall color harmony.
  let finished = 0;
  let harmonySum = 0;
  let harmonyN = 0;
  const clashing: Room[] = [];
  for (const r of enclosed) {
    const fl = roomFloor(d, r);
    const wa = roomWalls(d, r);
    finished += (fl && fl !== 'mixed' ? 0.5 : fl === 'mixed' ? 0.35 : 0) + (wa && wa !== 'mixed' ? 0.5 : wa === 'mixed' ? 0.35 : 0);
    const fm = floorMaterial(fl ?? undefined);
    const wm = wallFinish(wa ?? undefined);
    if (fm && wm) {
      const h = colorHarmony(fm.color, wm.color);
      harmonySum += h;
      harmonyN++;
      if (h < 0.6) clashing.push(r);
    }
  }
  const finish = finished / enclosed.length;
  const harmony = harmonyN ? harmonySum / harmonyN : 0.7;
  const bare = enclosed.filter((r) => !roomFloor(d, r) || !roomWalls(d, r)).length;
  if (bare) {
    issues.push({
      category: 'aesthetics',
      text: `${bare} room${bare === 1 ? ' is' : 's are'} missing a floor or wall finish.`,
      severity: 10 + 5 * bare,
    });
  }
  if (clashing.length) {
    issues.push({ category: 'aesthetics', text: `The floor and walls clash in the ${nameOf(clashing[0])}.`, severity: 8 });
  }

  // Decor density: a sweet spot, not clutter.
  const area = enclosed.reduce((s, r) => s + r.areaM2, 0);
  const decorCount = d.furniture.filter((f) => {
    const b = catalogItem(f.item)?.bucket;
    return b === 'decor' || b === 'luxury';
  }).length;
  const density = decorCount / Math.max(1, area / 10);
  const decor = density < 0.6 ? density / 0.6 : density <= 2 ? 1 : Math.max(0.4, 1 - (density - 2) * 0.2);
  if (density < 0.3) issues.push({ category: 'aesthetics', text: 'Rooms feel bare: add plants, art, rugs or lamps.', severity: 10 });
  else if (density > 3) issues.push({ category: 'aesthetics', text: 'Too much decor: rooms feel cluttered.', severity: 8 });

  // Luxury pieces are a direct boost.
  const luxury = d.furniture.filter((f) => catalogItem(f.item)?.bucket === 'luxury').length;
  const luxuryBonus = Math.min(15, luxury * 5);

  const base = 100 * (0.25 * themeScore + 0.2 * light + 0.15 * harmony + 0.2 * finish + 0.2 * decor);
  return {
    score: Math.round(Math.min(100, base + luxuryBonus)),
    issues,
    theme,
    themeShare,
    light,
    harmony,
    finish,
    decor,
    luxuryBonus,
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Up to 10% over is allowed with a penalty; beyond that the job can't be submitted. */
export const OVER_BUDGET_LIMIT = 0.1;

export function scoreBudget(cost: number, budget: number): PartScore & { canSubmit: boolean } {
  const issues: ScoreIssue[] = [];
  if (cost <= budget) {
    const savings = (budget - cost) / budget;
    return { score: Math.round(80 + 20 * Math.min(1, savings / 0.2)), issues, canSubmit: true };
  }
  const over = (cost - budget) / budget;
  const fmt = `$${Math.round(cost - budget).toLocaleString('en-US')}`;
  if (over > OVER_BUDGET_LIMIT) {
    issues.push({ category: 'budget', text: `Over budget by ${fmt}, more than the 10% the client allows.`, severity: 90 });
    return { score: 0, issues, canSubmit: false };
  }
  issues.push({ category: 'budget', text: `Over budget by ${fmt}.`, severity: 15 + over * 200 });
  return { score: Math.round(Math.max(0, 70 - 500 * over)), issues, canSubmit: true };
}

// ---------------------------------------------------------------------------
// Brief match
// ---------------------------------------------------------------------------

export interface BriefCheck {
  label: string;
  met: boolean;
  /** 0–1 partial credit. */
  credit: number;
  detail?: string;
}

export function checkBrief(d: Design, rooms: RoomMap, brief: Brief): BriefCheck[] {
  const checks: BriefCheck[] = [];
  const footprintM2 = d.footprint.size * CELL_M * CELL_M;
  for (const req of brief.requirements) {
    if (req.kind === 'room') {
      const name = roomType(req.roomType)?.name ?? req.roomType;
      const matching = rooms.rooms.filter((r) => r.enclosed && r.type === req.roomType);
      const bigEnough = req.minAreaM2 ? matching.filter((r) => r.areaM2 >= req.minAreaM2!) : matching;
      const have = bigEnough.length;
      const label = `${req.count} ${name.toLowerCase()}${req.count === 1 ? '' : 's'}${req.minAreaM2 ? ` (${req.minAreaM2} m²+)` : ''}`;
      let detail: string | undefined;
      if (have < req.count) {
        detail =
          matching.length > have
            ? `${matching.length - have} too small (smallest ${Math.min(...matching.map((r) => r.areaM2)).toFixed(1)} m²)`
            : `have ${have}`;
      }
      // Undersized rooms still earn some credit.
      const credit = Math.min(1, (have + 0.5 * (Math.min(matching.length, req.count) - Math.min(have, req.count))) / req.count);
      checks.push({ label, met: have >= req.count, credit, detail });
    } else if (req.kind === 'item') {
      const item = catalogItem(req.item);
      const have = d.furniture.filter((f) => f.item === req.item).length;
      const name = item?.name ?? req.item;
      checks.push({
        label: `${req.count} × ${name.toLowerCase()}`,
        met: have >= req.count,
        credit: Math.min(1, have / req.count),
        detail: have < req.count ? `have ${have}` : undefined,
      });
    } else if (req.kind === 'open') {
      const a = roomType(req.a)?.name ?? req.a;
      const b = roomType(req.b)?.name ?? req.b;
      const label = `${a} open to the ${b.toLowerCase()}`;
      const as = rooms.rooms.filter((r) => r.enclosed && r.type === req.a);
      const joined = as.some((r) => openNeighbors(rooms, r).some((n) => n.type === req.b));
      const both = as.length > 0 && rooms.rooms.some((r) => r.enclosed && r.type === req.b);
      checks.push({
        label,
        met: joined,
        credit: joined ? 1 : both ? 0.3 : 0,
        detail: joined ? undefined : both ? 'use the Transition tool between them instead of a wall' : 'need both rooms',
      });
    } else if (req.kind === 'roof') {
      const names = req.styles.map((st) => ROOF_STYLES[st as keyof typeof ROOF_STYLES]?.label.toLowerCase() ?? st);
      const ok = req.styles.includes(d.roof.style);
      checks.push({
        label: `A ${names.join(' or ')} roof`,
        met: ok,
        credit: ok ? 1 : 0,
        detail: ok ? undefined : `it's ${ROOF_STYLES[d.roof.style].label.toLowerCase()} now (Roof tool)`,
      });
    } else {
      const lo = req.minM2 ?? 0;
      const hi = req.maxM2 ?? Infinity;
      const ok = footprintM2 >= lo && footprintM2 <= hi;
      const miss = footprintM2 < lo ? (lo - footprintM2) / lo : footprintM2 > hi ? (footprintM2 - hi) / hi : 0;
      checks.push({
        label: `Floor area ${lo}–${hi === Infinity ? '∞' : hi} m²`,
        met: ok,
        credit: Math.max(0, 1 - miss * 2),
        detail: ok ? undefined : `${footprintM2.toFixed(0)} m² now`,
      });
    }
  }
  return checks;
}

export function scoreBrief(d: Design, rooms: RoomMap, brief: Brief): PartScore & { checks: BriefCheck[] } {
  const checks = checkBrief(d, rooms, brief);
  const score = checks.length ? Math.round((100 * checks.reduce((s, c) => s + c.credit, 0)) / checks.length) : 100;
  const issues: ScoreIssue[] = checks
    .filter((c) => !c.met)
    .map((c) => ({ category: 'brief' as const, text: `Brief asks for ${c.label}${c.detail ? `: ${c.detail}` : ''}.`, severity: 25 + (1 - c.credit) * 20 }));
  return { score, issues, checks };
}

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

export interface JobResult {
  briefId: string;
  total: number;
  stars: 0 | 1 | 2 | 3;
  passed: boolean;
  parts: { flow: number; aesthetics: number; budget: number; brief: number };
  cost: number;
  issues: ScoreIssue[];
  fee: number;
}

export function starsFor(total: number): 0 | 1 | 2 | 3 {
  return total >= 85 ? 3 : total >= 70 ? 2 : total >= 50 ? 1 : 0;
}

/** Combine part scores with the brief's weights. A job fails below 1 star or with half the brief missing. */
export function combineScores(
  brief: Brief,
  parts: { flow: number; aesthetics: number; budget: number; brief: number },
  cost: number,
  issues: ScoreIssue[],
): JobResult {
  const w = brief.weights;
  const total = Math.round(parts.flow * w.flow + parts.aesthetics * w.aesthetics + parts.budget * w.budget + parts.brief * w.brief);
  const stars = starsFor(total);
  const passed = stars >= 1 && parts.brief >= 50;
  const multiplier = [0, 1, 1.25, 1.5][stars];
  return {
    briefId: brief.id,
    total,
    stars: passed ? stars : 0,
    passed,
    parts,
    cost,
    issues: [...issues].sort((a, b) => b.severity - a.severity),
    fee: passed ? Math.round(brief.fee * multiplier) : 0,
  };
}

