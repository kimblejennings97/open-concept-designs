import { describe, expect, it } from 'vitest';
import { CATALOG, catalogItem } from '../data/catalog';
import { addOpening, addWalls, createDesign, encloseFootprint, paintFootprint, restore, snapshot } from './design';
import { lineEdges } from './grid';
import { findRooms, setRoomType } from './rooms';
import {
  type Furniture,
  addFurniture,
  checkFurniture,
  clearanceCells,
  doorSwingCells,
  footprintCells,
  rotatedSize,
  worldClearance,
} from './furniture';
import { computeCost } from './cost';

/** A walled 10×8-cell room at (0,0). */
function room() {
  const d = createDesign('t', 30, 30);
  paintFootprint(d, 0, 0, 9, 7, true);
  encloseFootprint(d);
  return d;
}

const piece = (item: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0, id = 'p'): Furniture => ({ id, item, x, y, rot });
const check = (d: ReturnType<typeof room>, f: Furniture) => checkFurniture(d, f, findRooms(d));

describe('catalog data', () => {
  it('has unique ids and sane sizes', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const i of CATALOG) {
      expect(i.w).toBeGreaterThan(0);
      expect(i.h).toBeGreaterThan(0);
      expect(i.cost).toBeGreaterThan(0);
    }
  });

  it('has at least 30 house and 15 store items', () => {
    expect(CATALOG.filter((i) => i.buildingTypes.includes('house')).length).toBeGreaterThanOrEqual(30);
    expect(CATALOG.filter((i) => i.buildingTypes.includes('store')).length).toBeGreaterThanOrEqual(15);
  });
});

describe('geometry', () => {
  it('rotation swaps the footprint and turns clearance clockwise', () => {
    const bed = catalogItem('bed-double')!; // front 2, back 0, left 1, right 1
    expect(rotatedSize(catalogItem('sofa')!, 1)).toEqual({ w: 2, h: 4 });
    // [top, right, bottom, left]
    expect(worldClearance(bed, 0)).toEqual([0, 1, 2, 1]);
    expect(worldClearance(bed, 1)).toEqual([1, 0, 1, 2]); // front now faces left
    expect(worldClearance(bed, 2)).toEqual([2, 1, 0, 1]);
  });

  it('clearance sits in front of the piece', () => {
    const toilet = catalogItem('toilet')!; // 1×2, front 2
    expect(clearanceCells(toilet, { x: 3, y: 0, rot: 0 })).toEqual(['3,2', '3,3']);
    expect(footprintCells(toilet, { x: 3, y: 0, rot: 0 })).toEqual(['3,0', '3,1']);
  });

  it('door swing covers the leaf sweep on the swing side', () => {
    const d = room();
    addOpening(d, { id: 'door', kind: 'door', o: 'h', x: 2, y: 0, len: 2, flip: false });
    expect([...doorSwingCells(d)].sort()).toEqual(['2,0', '2,1', '3,0', '3,1']);
  });
});

describe('checkFurniture', () => {
  it('accepts a bed against the wall with room in front', () => {
    const d = room();
    expect(check(d, piece('bed-double', 3, 0))).toEqual({ errors: [], warnings: [] });
  });

  it('rejects pieces outside the building or across a wall', () => {
    const d = room();
    expect(check(d, piece('sofa', 8, 0)).errors).toContain('Must be inside the building');
    addWalls(d, lineEdges(5, 0, 5, 8));
    expect(check(d, piece('sofa', 3, 3)).errors).toContain('Crosses a wall');
  });

  it('rejects overlaps on the same layer but allows a rug under a sofa', () => {
    const d = room();
    addFurniture(d, piece('sofa', 2, 3, 0, 'sofa'));
    expect(check(d, piece('armchair', 3, 3, 0, 'chair')).errors).toContain('Overlaps another item');
    expect(check(d, piece('rug-large', 1, 2, 0, 'rug')).errors).toEqual([]);
  });

  it('warns when clearance is blocked or the back is not on a wall', () => {
    const d = room();
    addFurniture(d, piece('sofa', 3, 2, 0, 'sofa'));
    // Bed at the top wall: its 2-cell front clearance runs into the sofa.
    expect(check(d, piece('bed-double', 3, 0, 0, 'bed')).errors).toContain('Overlaps another item');
    const w = check(d, piece('dresser', 3, 0, 0, 'dresser')); // 3×1 at y=0, clearance y=1..2 hits sofa at y=2
    expect(w.errors).toEqual([]);
    expect(w.warnings).toContain('Clearance is blocked');
    expect(check(d, piece('wardrobe', 3, 5, 0, 'w')).warnings).toContain('Should be backed against a wall');
  });

  it('wall art must hang on a wall', () => {
    const d = room();
    expect(check(d, piece('wall-art', 3, 0)).errors).toEqual([]);
    expect(check(d, piece('wall-art', 3, 3)).errors).toContain('Must hang on a wall');
  });

  it('flags pieces in a door swing and in the wrong room', () => {
    const d = room();
    addOpening(d, { id: 'door', kind: 'door', o: 'h', x: 2, y: 0, len: 2, flip: false });
    expect(check(d, piece('plant', 2, 1)).warnings).toContain("In a door's swing");
    setRoomType(d, findRooms(d).rooms[0], 'kitchen');
    expect(check(d, piece('toilet', 6, 0)).warnings[0]).toMatch(/Unusual in a kitchen/);
  });
});

describe('design integration', () => {
  it('furniture survives save/restore and drops when its floor goes', () => {
    const d = room();
    addFurniture(d, piece('sofa', 2, 3));
    expect(restore(snapshot(d)).furniture).toHaveLength(1);
    paintFootprint(d, 2, 3, 2, 3, false);
    expect(d.furniture).toHaveLength(0);
  });

  it('adds furniture to the cost', () => {
    const d = room();
    const before = computeCost(d, findRooms(d).rooms);
    addFurniture(d, piece('sofa', 2, 3, 0, 'a'));
    addFurniture(d, piece('plant', 0, 0, 0, 'b'));
    addFurniture(d, piece('statue', 6, 4, 0, 'c'));
    const after = computeCost(d, findRooms(d).rooms);
    expect(after.fixtures).toBe(1100);
    expect(after.decor).toBe(60 + 25000);
    expect(after.total - before.total).toBe(1100 + 60 + 25000);
  });
});
