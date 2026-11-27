import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { restore, snapshot, updateOpening } from './design';
import { doorColorId, doorStyle, isDoor } from './doors';
import { computeCost } from './cost';
import { findRooms } from './rooms';
import { sampleHouse, sampleStore } from './samples';
import { buildScene } from '../view3d/build';
import { CELL_M } from './grid';

describe('door looks', () => {
  it('default to a red panel front door and plain white inside doors', () => {
    const d = sampleHouse();
    const front = d.openings.find((o) => o.o === 'h' && o.y === 20 && isDoor(o))!;
    const inside = d.openings.find((o) => o.o === 'v' && isDoor(o))!;
    expect([doorStyle(d, front), doorColorId(d, front)]).toEqual(['panel', 'red']);
    expect([doorStyle(d, inside), doorColorId(d, inside)]).toEqual(['flush', 'white']);
  });

  it('can be changed, cost more when fancier, and survive saving', () => {
    const d = sampleHouse();
    const door = d.openings.find(isDoor)!;
    const before = computeCost(d, findRooms(d).rooms).total;
    expect(updateOpening(d, door.id, { style: 'glass', color: 'navy' })).toBe(true);
    expect(updateOpening(d, door.id, { style: 'glass' })).toBe(false);
    expect(computeCost(d, findRooms(d).rooms).total).toBeGreaterThan(before);
    const back = restore(snapshot(d)).openings.find((o) => o.id === door.id)!;
    expect([back.style, back.color]).toEqual(['glass', 'navy']);
  });
});

describe('3D doors', () => {
  it('hang one leaf per single door and two per double door', () => {
    for (const d of [sampleHouse(), sampleStore()]) {
      const expected = d.openings.reduce((n, o) => n + (o.kind === 'double-door' ? 2 : o.kind === 'door' ? 1 : 0), 0);
      const s = buildScene(d);
      expect(s.doors).toHaveLength(expected);
      s.dispose();
    }
  });

  it('shut leaves fill the opening; open ones swing 90° to the swing side', () => {
    const d = sampleHouse();
    for (const style of ['flush', 'panel', 'glass', 'plank'] as const) {
      for (const op of d.openings) if (isDoor(op)) op.style = style;
      const s = buildScene(d);
      s.root.updateMatrixWorld(true);
      for (const leaf of s.doors) {
        const op = d.openings.find((o) => o.id === leaf.id)!;
        const bb = new THREE.Box3().setFromObject(leaf.pivot);
        const along = op.o === 'h' ? [bb.min.x, bb.max.x] : [bb.min.z, bb.max.z];
        const start = (op.o === 'h' ? op.x : op.y) * CELL_M;
        expect(along[0]).toBeGreaterThan(start - 0.05);
        expect(along[1]).toBeLessThan(start + op.len * CELL_M + 0.05);
        expect(Math.abs(Math.abs(leaf.delta) - Math.PI / 2)).toBeLessThan(1e-9);

        // Fully open: the leaf now sticks out of the wall on the swing side.
        leaf.pivot.rotation.y = leaf.closed + leaf.delta;
        leaf.pivot.updateMatrixWorld(true);
        const open = new THREE.Box3().setFromObject(leaf.pivot);
        const wallPos = (op.o === 'h' ? op.y : op.x) * CELL_M;
        const side = op.flip ? -1 : 1;
        const reach = op.o === 'h' ? (side > 0 ? open.max.z : open.min.z) : side > 0 ? open.max.x : open.min.x;
        expect((reach - wallPos) * side).toBeGreaterThan(0.5);
      }
      s.dispose();
    }
  });
});
