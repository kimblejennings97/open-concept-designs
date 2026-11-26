import { describe, expect, it } from 'vitest';
import {
  type Opening,
  addOpening,
  addWalls,
  createDesign,
  deserialize,
  encloseFootprint,
  openingProblem,
  paintFootprint,
  removeWalls,
  restore,
  serialize,
  snapshot,
  stats,
  wallKind,
} from './design';
import { edgeKey, lineEdges, nearestEdge } from './grid';

/** A 4×3-cell room at (2,2)–(5,4), walled all round. */
function walledRoom() {
  const d = createDesign('test', 20, 20);
  paintFootprint(d, 2, 2, 5, 4, true);
  encloseFootprint(d);
  return d;
}

const op = (o: Partial<Opening>): Opening => ({ id: 'x', kind: 'door', o: 'h', x: 2, y: 2, len: 2, flip: false, ...o });

describe('footprint', () => {
  it('paints and clamps to the lot', () => {
    const d = createDesign('t', 10, 10);
    expect(paintFootprint(d, -5, -5, 1, 1, true)).toBe(true);
    expect(d.footprint.size).toBe(4);
    expect(paintFootprint(d, 0, 0, 1, 1, true)).toBe(false);
  });

  it('removing footprint drops walls and openings that lose their footing', () => {
    const d = walledRoom();
    addOpening(d, op({ id: 'w', kind: 'window', o: 'h', x: 3, y: 2, len: 2 }));
    expect(d.openings).toHaveLength(1);
    paintFootprint(d, 2, 2, 5, 4, false);
    expect(d.walls.size).toBe(0);
    expect(d.openings).toHaveLength(0);
  });
});

describe('walls', () => {
  it('enclose puts exterior walls on the whole perimeter', () => {
    const d = walledRoom();
    expect(d.walls.size).toBe(2 * (4 + 3));
    for (const k of d.walls) expect(wallKind(d, k)).toBe('exterior');
    expect(stats(d).exteriorWallM).toBe(7);
  });

  it('a wall across the room is interior; walls off the footprint are skipped', () => {
    const d = walledRoom();
    // Vertical line at x=4 from y=0 to y=7: only y=2..4 touch the footprint, and those are interior.
    expect(addWalls(d, lineEdges(4, 0, 4, 7))).toBe(true);
    expect(wallKind(d, edgeKey('v', 4, 3))).toBe('interior');
    expect(d.walls.has(edgeKey('v', 4, 0))).toBe(false);
    expect(stats(d).interiorWallM).toBe(1.5);
  });

  it('diagonal lines produce no edges', () => {
    expect(lineEdges(0, 0, 3, 2)).toEqual([]);
  });

  it('removing a wall removes doors on it', () => {
    const d = walledRoom();
    addOpening(d, op({ x: 3, y: 2 }));
    removeWalls(d, [edgeKey('h', 3, 2)]);
    expect(d.openings).toHaveLength(0);
  });
});

describe('openings', () => {
  it('doors need a wall', () => {
    const d = createDesign('t', 20, 20);
    paintFootprint(d, 2, 2, 5, 4, true);
    expect(openingProblem(d, op({}))).toMatch(/wall/);
  });

  it('windows only go on exterior walls', () => {
    const d = walledRoom();
    addWalls(d, lineEdges(4, 2, 4, 5));
    expect(openingProblem(d, op({ kind: 'window', o: 'v', x: 4, y: 2, len: 2 }))).toMatch(/exterior/);
    expect(openingProblem(d, op({ kind: 'window', o: 'v', x: 2, y: 2, len: 2 }))).toBeNull();
    expect(openingProblem(d, op({ kind: 'door', o: 'v', x: 4, y: 2, len: 2 }))).toBeNull();
  });

  it('openings cannot overlap', () => {
    const d = walledRoom();
    expect(addOpening(d, op({ id: 'a', x: 2 }))).toBe(true);
    expect(addOpening(d, op({ id: 'b', x: 3 }))).toBe(false);
    expect(addOpening(d, op({ id: 'c', x: 4 }))).toBe(true);
  });

  it('openings cannot run past the end of a wall', () => {
    const d = walledRoom();
    expect(openingProblem(d, op({ x: 5 }))).not.toBeNull();
  });

  it('rejects wrong widths', () => {
    const d = walledRoom();
    expect(openingProblem(d, op({ len: 3 }))).toMatch(/width/);
  });
});

describe('serialization', () => {
  it('round-trips', () => {
    const d = walledRoom();
    addOpening(d, op({ id: 'a' }));
    const back = restore(snapshot(d));
    expect(serialize(back)).toEqual(serialize(d));
  });

  it('rejects foreign files', () => {
    expect(() => deserialize({ hello: 1 })).toThrow();
    expect(() => deserialize({ ...serialize(createDesign()), version: 99 })).toThrow(/version/);
  });
});

describe('nearestEdge', () => {
  it('picks the closer grid line', () => {
    expect(nearestEdge(3.5, 2.1, 0.45)).toEqual({ o: 'h', x: 3, y: 2 });
    expect(nearestEdge(2.9, 5.5, 0.45)).toEqual({ o: 'v', x: 3, y: 5 });
    expect(nearestEdge(3.5, 2.5, 0.45)).toBeNull();
  });
});
