/**
 * Typed access to the JSON content files. Content lives in JSON so new materials,
 * room types and prices need no code changes.
 */
import materials from './materials.json';
import roomTypes from './roomTypes.json';
import costs from './costs.json';

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
