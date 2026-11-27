/**
 * Turns a Design into a Three.js scene graph. World units are meters: x = east, z = south
 * (the blueprint's y), y = up. One grid cell is CELL_M (0.5 m).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COSTS, type CatalogItem, catalogItem, floorMaterial, wallFinish } from '../data/catalog';
import { type Design, openingEdges, wallKind } from '../model/design';
import type { Furniture } from '../model/furniture';
import { CELL_M, parseCell, parseEdge } from '../model/grid';
import { parseSideKey } from '../model/rooms';
import { roofGeometry } from './roof3d';
import { box, merged } from './geom';
import { doorLeaves, type DoorLeaf } from './doors3d';

export const WALL_H = COSTS.wallHeightM;
const DOOR_H = 2.1;
const SILL_H = 0.9;
const WIN_TOP = 2.1;
const EXT_T = 0.25;
const INT_T = 0.15;

export interface BuiltScene {
  root: THREE.Group;
  /** Walls, lintels, sills and glass; scaled down for the cutaway view. */
  walls: THREE.Group;
  /** The roof; hidden in the cutaway view. */
  roof: THREE.Group;
  /** Center of the building footprint, for aiming the camera. */
  center: THREE.Vector3;
  /** Rough size of the building, for camera distance. */
  radius: number;
  /** Door leaves on hinge pivots (inside the walls group), for opening on tap. */
  doors: DoorLeaf[];
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Furniture models: a few boxes per item, in the item's local footprint at rotation 0
// (u across, v front-to-back with the front at v = h), heights in meters.
// ---------------------------------------------------------------------------

interface Part {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  y0: number;
  y1: number;
  color: string;
}

const WHITE = '#eef1f4';
const DARK = '#3a3f47';
const WOOD = '#8c6440';
const GLASS = '#a9d8ef';
const GREEN = '#4f8f4a';

const HEIGHTS: Record<string, number> = {
  nightstand: 0.55, dresser: 0.9, wardrobe: 2.0, desk: 0.75, vanity: 0.85, bathtub: 0.55, shower: 2.0,
  fridge: 1.8, stove: 0.9, counter: 0.9, 'kitchen-sink': 0.9, dishwasher: 0.85, island: 0.92, 'coffee-table': 0.4,
  bookshelf: 1.8, washer: 0.85, dryer: 0.85, 'shoe-bench': 0.45, workbench: 0.9, 'shelf-aisle': 1.5,
  'wall-shelf': 1.8, 'fridge-case': 2.0, 'freezer-chest': 0.85, 'ice-chest': 1.0, 'hot-food-case': 1.2,
  'display-table': 0.8, 'magazine-rack': 1.2, 'checkout-counter': 0.95, 'impulse-rack': 1.3,
  'coffee-station': 1.0, 'cart-corral': 0.8, 'stock-rack': 2.2, 'office-desk': 0.75, statue: 1.8, 'grand-piano': 1.0,
};

function partsFor(item: CatalogItem): Part[] {
  const { w, h } = item;
  const c = item.color;
  const all = (y0: number, y1: number, col = c, inset = 0.04): Part => ({ u0: inset, v0: inset, u1: w - inset, v1: h - inset, y0, y1, color: col });
  const back = (depth: number, y0: number, y1: number, col = c): Part => ({ u0: 0.04, v0: 0.02, u1: w - 0.04, v1: depth, y0, y1, color: col });

  switch (item.id) {
    case 'bed-double':
    case 'bed-single':
      return [
        all(0, 0.35, WOOD),
        { u0: 0.1, v0: 0.2, u1: w - 0.1, v1: h - 0.08, y0: 0.35, y1: 0.55, color: WHITE },
        { u0: 0.15, v0: h * 0.45, u1: w - 0.15, v1: h - 0.1, y0: 0.55, y1: 0.6, color: c },
        { u0: 0.2, v0: 0.25, u1: w - 0.2, v1: 0.9, y0: 0.55, y1: 0.68, color: WHITE },
        back(0.15, 0, 1.0, WOOD),
      ];
    case 'sofa':
    case 'armchair':
      return [all(0, 0.42), back(0.55, 0.42, 0.85), { u0: 0.04, v0: 0.04, u1: 0.4, v1: h - 0.04, y0: 0.42, y1: 0.62, color: c }, { u0: w - 0.4, v0: 0.04, u1: w - 0.04, v1: h - 0.04, y0: 0.42, y1: 0.62, color: c }];
    case 'toilet':
      return [back(0.7, 0, 0.8, WHITE), { u0: 0.2, v0: 0.5, u1: w - 0.2, v1: h - 0.15, y0: 0, y1: 0.42, color: WHITE }];
    case 'dining-table':
    case 'desk':
    case 'office-desk':
    case 'coffee-table':
    case 'display-table': {
      const top = HEIGHTS[item.id] ?? 0.75;
      const leg = (u: number, v: number): Part => ({ u0: u, v0: v, u1: u + 0.12, v1: v + 0.12, y0: 0, y1: top - 0.04, color: WOOD });
      return [all(top - 0.05, top, c, 0.02), leg(0.15, 0.15), leg(w - 0.27, 0.15), leg(0.15, h - 0.27), leg(w - 0.27, h - 0.27)];
    }
    case 'tv-stand':
      return [all(0, 0.5), { u0: 0.3, v0: 0.15, u1: w - 0.3, v1: 0.3, y0: 0.5, y1: 1.25, color: '#15181c' }];
    case 'stove':
      return [all(0, 0.88, WHITE), all(0.88, 0.92, '#15181c')];
    case 'counter':
    case 'kitchen-sink':
    case 'island':
    case 'checkout-counter':
      return [all(0, (HEIGHTS[item.id] ?? 0.9) - 0.05, WOOD), all((HEIGHTS[item.id] ?? 0.9) - 0.05, HEIGHTS[item.id] ?? 0.9, c, 0)];
    case 'fridge-case':
    case 'shower':
      return [all(0, HEIGHTS[item.id], c), { u0: 0.1, v0: h - 0.12, u1: w - 0.1, v1: h - 0.04, y0: 0.15, y1: HEIGHTS[item.id] - 0.15, color: GLASS }];
    case 'shelf-aisle':
    case 'wall-shelf':
    case 'stock-rack':
    case 'bookshelf': {
      const top = HEIGHTS[item.id];
      const parts: Part[] = [all(0, 0.12, DARK)];
      for (let y = 0.45; y < top; y += 0.4) parts.push(all(y - 0.03, y, c));
      parts.push(back(item.id === 'shelf-aisle' ? h : 0.15, 0, top, DARK));
      return parts;
    }
    case 'plant':
      return [
        { u0: 0.25, v0: 0.25, u1: w - 0.25, v1: h - 0.25, y0: 0, y1: 0.35, color: '#a0603a' },
        { u0: 0.1, v0: 0.1, u1: w - 0.1, v1: h - 0.1, y0: 0.35, y1: 1.1, color: GREEN },
      ];
    case 'floor-lamp':
      return [
        { u0: 0.42, v0: 0.42, u1: w - 0.42, v1: h - 0.42, y0: 0, y1: 1.4, color: DARK },
        { u0: 0.15, v0: 0.15, u1: w - 0.15, v1: h - 0.15, y0: 1.4, y1: 1.7, color: c },
      ];
    case 'coat-rack':
      return [{ u0: 0.4, v0: 0.4, u1: w - 0.4, v1: h - 0.4, y0: 0, y1: 1.75, color: c }];
    case 'grand-piano':
      return [all(0.65, 1.0, c), back(1.0, 0, 1.0, c)];
  }
  if (item.layer === 'floor') return [all(0, 0.02, c, 0.05)];
  if (item.layer === 'wall') return [back(0.08, item.id === 'mirror' ? 1.0 : 1.2, 1.8, c)];
  if (item.layer === 'ceiling') {
    const drop = item.id === 'chandelier' ? 0.7 : item.id === 'store-sign' ? 0.4 : 0.35;
    return [all(WALL_H - drop, WALL_H - 0.1, c, 0.15), { u0: w / 2 - 0.03, v0: h / 2 - 0.03, u1: w / 2 + 0.03, v1: h / 2 + 0.03, y0: WALL_H - 0.1, y1: WALL_H, color: DARK }];
  }
  return [all(0, HEIGHTS[item.id] ?? 0.8)];
}

/** Map a point in an item's local footprint (cells) to blueprint cells for a placed piece. */
function toPlan(f: Furniture, item: CatalogItem, u: number, v: number): [number, number] {
  const { w, h } = item;
  switch (f.rot) {
    case 1:
      return [f.x + (h - v), f.y + u];
    case 2:
      return [f.x + (w - u), f.y + (h - v)];
    case 3:
      return [f.x + v, f.y + (w - u)];
    default:
      return [f.x + u, f.y + v];
  }
}

function furnitureGeometry(d: Design): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const f of d.furniture) {
    const item = catalogItem(f.item);
    if (!item) continue;
    for (const p of partsFor(item)) {
      // Parts are in cells across the footprint; convert both corners, then to meters.
      const [ax, az] = toPlan(f, item, p.u0, p.v0);
      const [bx, bz] = toPlan(f, item, p.u1, p.v1);
      out.push(box(Math.min(ax, bx) * CELL_M, p.y0, Math.min(az, bz) * CELL_M, Math.max(ax, bx) * CELL_M, p.y1, Math.max(az, bz) * CELL_M, p.color));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function buildScene(d: Design): BuiltScene {
  const root = new THREE.Group();
  const walls = new THREE.Group();
  const roof = new THREE.Group();
  root.add(walls, roof);
  const disposables: Array<{ dispose: () => void }> = [];
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: GLASS, transparent: true, opacity: 0.35, roughness: 0.1 });
  disposables.push(solid, glass);

  // Ground (the lot) and a little grass beyond it.
  const lotW = d.lotW * CELL_M;
  const lotH = d.lotH * CELL_M;
  const groundGeo = new THREE.PlaneGeometry(lotW + 40, lotH + 40);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(lotW / 2, -0.01, lotH / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: '#7d9a62', roughness: 1 }));
  ground.receiveShadow = true;
  root.add(ground);
  const lotGeo = new THREE.PlaneGeometry(lotW, lotH);
  lotGeo.rotateX(-Math.PI / 2);
  lotGeo.translate(lotW / 2, 0, lotH / 2);
  const lot = new THREE.Mesh(lotGeo, new THREE.MeshStandardMaterial({ color: '#8fae72', roughness: 1 }));
  lot.receiveShadow = true;
  root.add(lot);
  disposables.push(groundGeo, lotGeo, ground.material as THREE.Material, lot.material as THREE.Material);

  // Floors: a thin slab per footprint cell, colored by its material.
  const floorParts: THREE.BufferGeometry[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const k of d.footprint) {
    const [x, y] = parseCell(k);
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, y);
    maxX = Math.max(maxX, x + 1);
    maxZ = Math.max(maxZ, y + 1);
    const mat = floorMaterial(d.floors.get(k));
    floorParts.push(box(x * CELL_M, 0, y * CELL_M, (x + 1) * CELL_M, 0.05, (y + 1) * CELL_M, mat?.color ?? '#9aa0a6'));
  }
  // Transitions: a slim threshold strip where two open-plan rooms meet.
  for (const k of d.transitions) {
    const e = parseEdge(k);
    const w = 0.03;
    if (e.o === 'h') floorParts.push(box(e.x * CELL_M, 0.05, e.y * CELL_M - w, (e.x + 1) * CELL_M, 0.058, e.y * CELL_M + w, '#b9b2a5'));
    else floorParts.push(box(e.x * CELL_M - w, 0.05, e.y * CELL_M, e.x * CELL_M + w, 0.058, (e.y + 1) * CELL_M, '#b9b2a5'));
  }
  const floors = merged(floorParts, solid, false);
  if (floors) root.add(floors);

  // Walls, with gaps for doors and windows.
  const openAt = new Map<string, 'door' | 'window'>();
  for (const op of d.openings) for (const k of openingEdges(op)) openAt.set(k, op.kind === 'window' ? 'window' : 'door');
  const wallParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const segment = (key: string, y0: number, y1: number, hex: string) => {
    const e = parseEdge(key);
    const t = wallKind(d, key) === 'exterior' ? EXT_T : INT_T;
    if (e.o === 'h') wallParts.push(box(e.x * CELL_M - t / 2, y0, e.y * CELL_M - t / 2, (e.x + 1) * CELL_M + t / 2, y1, e.y * CELL_M + t / 2, hex));
    else wallParts.push(box(e.x * CELL_M - t / 2, y0, e.y * CELL_M - t / 2, e.x * CELL_M + t / 2, y1, (e.y + 1) * CELL_M + t / 2, hex));
  };
  for (const k of d.walls) {
    const ext = wallKind(d, k) === 'exterior';
    const hex = ext ? '#e9e4da' : '#f3f1ec';
    const kind = openAt.get(k);
    if (!kind) segment(k, 0, WALL_H, hex);
    else if (kind === 'door') segment(k, DOOR_H, WALL_H, hex);
    else {
      segment(k, 0, SILL_H, hex);
      segment(k, WIN_TOP, WALL_H, hex);
      const e = parseEdge(k);
      const g = 0.03;
      if (e.o === 'h') glassParts.push(new THREE.BoxGeometry(CELL_M, WIN_TOP - SILL_H, g).translate((e.x + 0.5) * CELL_M, (SILL_H + WIN_TOP) / 2, e.y * CELL_M));
      else glassParts.push(new THREE.BoxGeometry(g, WIN_TOP - SILL_H, CELL_M).translate(e.x * CELL_M, (SILL_H + WIN_TOP) / 2, (e.y + 0.5) * CELL_M));
    }
  }
  // Wall finishes: a thin colored skin on the room side.
  for (const [sk, id] of d.wallFinishes) {
    const fin = wallFinish(id);
    if (!fin) continue;
    const { edge, side } = parseSideKey(sk);
    const kind = openAt.get(edge);
    const e = parseEdge(edge);
    const t = wallKind(d, edge) === 'exterior' ? EXT_T : INT_T;
    const off = (side === 1 ? 1 : -1) * (t / 2 + 0.006);
    const spans: Array<[number, number]> = !kind ? [[0.05, WALL_H]] : kind === 'door' ? [[DOOR_H, WALL_H]] : [[0.05, SILL_H], [WIN_TOP, WALL_H]];
    for (const [y0, y1] of spans) {
      if (e.o === 'h') {
        const z = e.y * CELL_M + off;
        wallParts.push(box(e.x * CELL_M, y0, z - 0.006, (e.x + 1) * CELL_M, y1, z + 0.006, fin.color));
      } else {
        const x = e.x * CELL_M + off;
        wallParts.push(box(x - 0.006, y0, e.y * CELL_M, x + 0.006, y1, (e.y + 1) * CELL_M, fin.color));
      }
    }
  }
  const doorSet = doorLeaves(d, { solid, glass, doorH: DOOR_H, extT: EXT_T, intT: INT_T });
  walls.add(doorSet.group);
  disposables.push(...doorSet.geometries);
  const wallMesh = merged(wallParts, solid);
  if (wallMesh) walls.add(wallMesh);
  if (glassParts.length) {
    const g = mergeGeometries(glassParts, false);
    for (const p of glassParts) p.dispose();
    if (g) {
      walls.add(new THREE.Mesh(g, glass));
      disposables.push(g);
    }
  }

  const roofGeo = roofGeometry(d, WALL_H);
  if (roofGeo) {
    const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(roofGeo, roofMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    roof.add(mesh);
    disposables.push(roofGeo, roofMat);
  }

  const furniture = merged(furnitureGeometry(d), solid);
  if (furniture) root.add(furniture);

  for (const m of [floors, wallMesh, furniture]) if (m) disposables.push(m.geometry);

  const hasBuilding = Number.isFinite(minX);
  const center = hasBuilding
    ? new THREE.Vector3(((minX + maxX) / 2) * CELL_M, 0, ((minZ + maxZ) / 2) * CELL_M)
    : new THREE.Vector3(lotW / 2, 0, lotH / 2);
  const radius = hasBuilding ? Math.hypot(maxX - minX, maxZ - minZ) * CELL_M * 0.5 : Math.hypot(lotW, lotH) / 2;
  return { root, walls, roof, doors: doorSet.leaves, center, radius: Math.max(3, radius), dispose: () => disposables.forEach((x) => x.dispose()) };
}
