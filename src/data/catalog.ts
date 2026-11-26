/**
 * Typed access to the JSON content files. Content lives in JSON so new materials,
 * room types and prices need no code changes.
 */
import materials from './materials.json';
import roomTypes from './roomTypes.json';
import costs from './costs.json';
import catalog from './catalog.json';
import briefs from './briefs.json';

export type BuildingType = 'house' | 'store';

export interface Material {
  id: string;
  name: string;
  color: string;
  costPerM2: number;
  tags: string[];
  /** Career tier that unlocks it. */
  tier: number;
}

export interface RoomType {
  id: string;
  name: string;
  buildingTypes: BuildingType[];
  plumbing: boolean;
  /** Smallest sensible size; used for warnings and brief checks later. */
  minAreaM2: number;
}

export type FurnitureLayer = 'floor' | 'object' | 'wall' | 'ceiling';
export type CostBucketId = 'fixtures' | 'decor' | 'luxury';

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  buildingTypes: BuildingType[];
  /** Room types it's meant for; empty = anywhere. */
  roomTypes: string[];
  /** Footprint in cells at rotation 0 (front faces +y). */
  w: number;
  h: number;
  /** Free space it needs around it, in cells, relative to the item. */
  clearance: { front: number; back: number; left: number; right: number };
  layer: FurnitureLayer;
  againstWall: boolean;
  cost: number;
  bucket: CostBucketId;
  tags: string[];
  tier: number;
  color: string;
}

export type Requirement =
  | { kind: 'room'; roomType: string; count: number; minAreaM2?: number }
  | { kind: 'item'; item: string; count: number }
  | { kind: 'footprint'; minM2?: number; maxM2?: number };

export interface ScoreWeights {
  flow: number;
  aesthetics: number;
  budget: number;
  brief: number;
}

export interface Brief {
  id: string;
  tier: number;
  building: BuildingType;
  client: string;
  clientRole: string;
  title: string;
  summary: string;
  /** Lot size in meters. */
  lot: { w: number; h: number };
  budget: number;
  fee: number;
  theme: string;
  weights: ScoreWeights;
  requirements: Requirement[];
}

export const BRIEFS: readonly Brief[] = briefs.briefs as Brief[];
const briefById = new Map(BRIEFS.map((b) => [b.id, b]));
export const getBrief = (id: string | undefined) => (id ? briefById.get(id) : undefined);

export const THEME_NAMES: Record<string, string> = {
  cozy: 'Cozy',
  modern: 'Modern',
  rustic: 'Rustic',
  classic: 'Classic',
  industrial: 'Industrial',
  luxury: 'Luxury',
};

export const CATALOG: readonly CatalogItem[] = catalog.items as CatalogItem[];
const itemById = new Map(CATALOG.map((i) => [i.id, i]));
export const catalogItem = (id: string | undefined) => (id ? itemById.get(id) : undefined);

export const FLOOR_MATERIALS: readonly Material[] = materials.floors;
export const WALL_FINISHES: readonly Material[] = materials.walls;
export const ROOM_TYPES: readonly RoomType[] = roomTypes as RoomType[];
export const COSTS = costs;

const byId = <T extends { id: string }>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]));
const floorById = byId(FLOOR_MATERIALS);
const wallById = byId(WALL_FINISHES);
const roomById = byId(ROOM_TYPES);

export const floorMaterial = (id: string | undefined) => (id ? floorById.get(id) : undefined);
export const wallFinish = (id: string | undefined) => (id ? wallById.get(id) : undefined);
export const roomType = (id: string | undefined) => (id ? roomById.get(id) : undefined);
