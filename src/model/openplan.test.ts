import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  addOpening,
  addTransitions,
  addWalls,
  createDesign,
  encloseFootprint,
  paintFootprint,
  removeTransitions,
  restore,
  setRoof,
  snapshot,
} from './design';
import { edgeKey, lineEdges } from './grid';
import { findRooms, openGroups, setRoomType } from './rooms';
import { checkFurniture } from './furniture';
import { roofPlan, normalizeRoof, roofLines, DEFAULT_ROOF, type RoofStyle } from './roof';
import { checkBrief, scoreAesthetics } from './scoring';
import { getBrief } from '../data/catalog';
import { sampleHouse } from './samples';
import { buildNavGrid } from '../sim/scenarios';
import { findPath } from '../sim/astar';
import { buildScene } from '../view3d/build';

/** 8×4 box with a transition (not a wall) at x=4. */
function openPair() {
  const d = createDesign('t', 20, 20);
  paintFootprint(d, 0, 0, 7, 3, true);
  encloseFootprint(d);
  addTransitions(d, lineEdges(4, 0, 4, 4));
  return d;
}

describe('transitions', () => {
  it('split rooms but leave both enclosed and open to each other', () => {
    const d = openPair();
    const map = findRooms(d);
    expect(map.rooms).toHaveLength(2);
    expect(map.rooms.every((r) => r.enclosed && r.transitions.length === 4)).toBe(true);
    expect(openGroups(map)).toHaveLength(1);
  });

  it('only go between two footprint cells, and replace walls', () => {
    const d = createDesign('t', 20, 20);
    paintFootprint(d, 0, 0, 7, 3, true);
    encloseFootprint(d);
    expect(addTransitions(d, lineEdges(0, 0, 0, 4))).toBe(false); // outside wall line
    addWalls(d, lineEdges(4, 0, 4, 4));
    addOpening(d, { id: 'door', kind: 'door', o: 'v', x: 4, y: 1, len: 2, flip: false });
    expect(addTransitions(d, lineEdges(4, 0, 4, 4))).toBe(true);
    expect(d.walls.has(edgeKey('v', 4, 0))).toBe(false);
    expect(d.openings).toHaveLength(0); // the door went with its wall
    addWalls(d, [edgeKey('v', 4, 0)]);
    expect(d.transitions.has(edgeKey('v', 4, 0))).toBe(false);
  });

  it('removing a transition merges the rooms', () => {
    const d = openPair();
    removeTransitions(d, lineEdges(4, 0, 4, 4));
    expect(findRooms(d).rooms).toHaveLength(1);
  });

  it('survive save/load and footprint edits', () => {
    const d = openPair();
    const back = restore(snapshot(d));
    expect([...back.transitions].sort()).toEqual([...d.transitions].sort());
    paintFootprint(back, 4, 0, 7, 3, false);
    expect(back.transitions.size).toBe(0);
  });

  it('people walk straight through them', () => {
    const d = openPair();
    const grid = buildNavGrid(d);
    const path = findPath(grid, 1 * grid.w + 1, 1 * grid.w + 6);
    expect(path).not.toBeNull();
    expect(path!.cost).toBe(5); // a straight line, no detour
  });

  it('furniture may straddle a transition but not a wall', () => {
    const d = openPair();
    const rug = { id: 'r', item: 'rug-large', x: 2, y: 0, rot: 0 as const };
    expect(checkFurniture(d, rug, findRooms(d)).errors).toEqual([]);
    const walled = createDesign('t', 20, 20);
    paintFootprint(walled, 0, 0, 7, 3, true);
    encloseFootprint(walled);
    addWalls(walled, lineEdges(4, 0, 4, 4));
    expect(checkFurniture(walled, rug, findRooms(walled)).errors).toContain('Crosses a wall');
  });

  it('open-plan rooms share daylight', () => {
    const d = openPair();
    const map = findRooms(d);
    setRoomType(d, map.byCell.get('0,0')!, 'kitchen');
    setRoomType(d, map.byCell.get('5,0')!, 'living');
    addOpening(d, { id: 'w', kind: 'window', o: 'h', x: 5, y: 0, len: 2, flip: false });
    const a = scoreAesthetics(d, findRooms(d));
    expect(a.issues.some((i) => i.text.includes('no windows'))).toBe(false);
  });

  it('the starter-home brief wants an open kitchen, and the sample house has one', () => {
    const brief = getBrief('starter-home')!;
    const d = sampleHouse();
    const open = checkBrief(d, findRooms(d), brief).find((c) => c.label.includes('open to'));
    expect(open?.met).toBe(true);
    addWalls(d, lineEdges(20, 12, 28, 12));
    expect(checkBrief(d, findRooms(d), brief).find((c) => c.label.includes('open to'))?.met).toBe(false);
  });
});

describe('roofs', () => {
  it('normalizes bad data to the default', () => {
    expect(normalizeRoof(undefined)).toEqual(DEFAULT_ROOF);
    expect(normalizeRoof({ style: 'dome', pitch: 999 })).toEqual(DEFAULT_ROOF);
    const d = createDesign();
    expect(setRoof(d, { style: 'hip' })).toBe(true);
    expect(setRoof(d, { style: 'hip' })).toBe(false);
    expect(restore(snapshot(d)).roof.style).toBe('hip');
  });

  it('covers a rectangle with one section along its long side', () => {
    const fp = new Set<string>();
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) fp.add(`${x},${y}`);
    const [r, ...rest] = roofPlan(fp, DEFAULT_ROOF);
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({ x0: 0, y0: 0, x1: 10, y1: 6, axis: 'x' });
    expect(roofPlan(fp, { ...DEFAULT_ROOF, turned: true })[0].axis).toBe('y');
  });

  it('covers an L-shape with two overlapping wings', () => {
    const fp = new Set<string>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) fp.add(`${x},${y}`);
    for (let y = 4; y < 12; y++) for (let x = 0; x < 4; x++) fp.add(`${x},${y}`);
    const rects = roofPlan(fp, DEFAULT_ROOF);
    expect(rects).toHaveLength(2);
    const covered = new Set<string>();
    for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) covered.add(`${x},${y}`);
    expect([...fp].every((k) => covered.has(k))).toBe(true);
    expect(new Set(rects.map((r) => r.axis))).toEqual(new Set(['x', 'y']));
    expect(roofLines(rects, { ...DEFAULT_ROOF, style: 'hip' })).toHaveLength(10);
  });

  it('builds finite 3D geometry for every style', () => {
    for (const style of ['gable', 'hip', 'shed', 'flat'] as RoofStyle[]) {
      const d = sampleHouse();
      paintFootprint(d, 4, 20, 9, 25, true); // make it L-shaped
      d.roof = { ...d.roof, style };
      const s = buildScene(d);
      const roofMeshes: THREE.Mesh[] = [];
      s.roof.traverse((o) => (o as THREE.Mesh).isMesh && roofMeshes.push(o as THREE.Mesh));
      expect(roofMeshes).toHaveLength(1);
      const pos = roofMeshes[0].geometry.attributes.position.array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      expect([...pos].every(Number.isFinite)).toBe(true);
      // The highest point is above the walls for pitched roofs.
      let top = 0;
      for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
      expect(top).toBeGreaterThan(2.7);
      s.dispose();
    }
  });

  it('a pitched roof can be a brief requirement', () => {
    const brief = getBrief('retiree-cottage')!;
    const d = createDesign();
    const check = () => checkBrief(d, findRooms(d), brief).find((c) => c.label.includes('roof'))!;
    expect(check().met).toBe(true); // gable by default
    setRoof(d, { style: 'flat' });
    expect(check().met).toBe(false);
  });
});
