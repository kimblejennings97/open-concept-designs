import { COSTS, floorMaterial, roomType, wallFinish } from '../data/catalog';
import { type Design, openingEdges, stats, wallKind } from './design';
import { CELL_M } from './grid';
import type { Room } from './rooms';

export type CostBucket = 'structure' | 'systems' | 'finishes';

export interface CostLine {
  bucket: CostBucket;
  label: string;
  amount: number;
}

export interface CostSummary {
  lines: CostLine[];
  structure: number;
  systems: number;
  finishes: number;
  total: number;
}

export function computeCost(d: Design, rooms: Room[]): CostSummary {
  const s = stats(d);
  const lines: CostLine[] = [];
  const add = (bucket: CostBucket, label: string, amount: number) => {
    if (amount > 0) lines.push({ bucket, label, amount: Math.round(amount) });
  };

  // Structure
  add('structure', 'Foundation & roof', s.footprintM2 * COSTS.structure.foundationAndRoofPerM2);
  add('structure', 'Exterior walls', s.exteriorWallM * COSTS.structure.exteriorWallPerM);
  add('structure', 'Interior walls', s.interiorWallM * COSTS.structure.interiorWallPerM);
  let doors = 0;
  let windows = 0;
  for (const op of d.openings) {
    if (op.kind === 'window') {
      windows += op.len * CELL_M * COSTS.openings.windowPerM;
    } else {
      const ext = wallKind(d, openingEdges(op)[0]) === 'exterior';
      doors += COSTS.openings[op.kind][ext ? 'exterior' : 'interior'];
    }
  }
  add('structure', 'Doors', doors);
  add('structure', 'Windows', windows);

  // Systems
  const plumbed = rooms.filter((r) => roomType(r.type)?.plumbing).length;
  add('systems', `Plumbing (${plumbed} room${plumbed === 1 ? '' : 's'})`, plumbed * COSTS.systems.plumbingPerRoom);
  if (s.footprintM2 > 0) add('systems', 'HVAC', COSTS.systems.hvacBase + s.footprintM2 * COSTS.systems.hvacPerM2);

  // Finishes
  let floors = 0;
  for (const id of d.floors.values()) floors += (floorMaterial(id)?.costPerM2 ?? 0) * CELL_M * CELL_M;
  add('finishes', 'Flooring', floors);
  let walls = 0;
  for (const id of d.wallFinishes.values()) walls += (wallFinish(id)?.costPerM2 ?? 0) * CELL_M * COSTS.wallHeightM;
  add('finishes', 'Wall finishes', walls);

  const sum = (b: CostBucket) => lines.filter((l) => l.bucket === b).reduce((t, l) => t + l.amount, 0);
  const structure = sum('structure');
  const systems = sum('systems');
  const finishes = sum('finishes');
  return { lines, structure, systems, finishes, total: structure + systems + finishes };
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
