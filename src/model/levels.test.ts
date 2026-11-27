import { describe, expect, it } from 'vitest';
import { BRIEFS, catalogItem, roomType } from '../data/catalog';
import { TIERS } from '../game/career';
import { checkAllFurniture } from './furniture';
import { findRooms } from './rooms';
import { sampleApartments, sampleBistro, sampleClub } from './samples';
import { inferBuilding, simulateFlow } from '../sim/scenarios';
import { buildScene } from '../view3d/build';

describe('bigger buildings', () => {
  const cases = [
    ['restaurant', sampleBistro],
    ['club', sampleClub],
    ['apartment', sampleApartments],
  ] as const;

  for (const [building, make] of cases) {
    it(`sample ${building} is valid, recognised and simulates well`, () => {
      const d = make();
      const rooms = findRooms(d);
      expect(rooms.rooms.every((r) => r.enclosed)).toBe(true);
      expect(rooms.rooms.filter((r) => !r.type)).toEqual([]);
      const problems = [...checkAllFurniture(d, rooms)].filter(([, c]) => c.errors.length);
      expect(problems.map(([id, c]) => `${d.furniture.find((f) => f.id === id)?.item}: ${c.errors.join(', ')}`)).toEqual([]);
      expect(inferBuilding(d, rooms)).toBe(building);
      const flow = simulateFlow(d, rooms, building);
      expect(flow.people).toBeGreaterThanOrEqual(8);
      expect(flow.finished).toBe(flow.people);
      expect(flow.score).toBeGreaterThan(60);
      const s = buildScene(d);
      s.dispose();
    });
  }
});

describe('career content', () => {
  it('every brief uses real rooms and pieces that its building and tier allow', () => {
    for (const b of BRIEFS) {
      for (const r of b.requirements) {
        if (r.kind === 'room') expect(roomType(r.roomType)?.buildingTypes, `${b.id}: ${r.roomType}`).toContain(b.building);
        if (r.kind === 'open') for (const t of [r.a, r.b]) expect(roomType(t)?.buildingTypes, `${b.id}: ${t}`).toContain(b.building);
        if (r.kind === 'item') {
          const item = catalogItem(r.item);
          expect(item?.buildingTypes, `${b.id}: ${r.item}`).toContain(b.building);
          expect(item!.tier, `${b.id}: ${r.item} tier`).toBeLessThanOrEqual(b.tier);
        }
      }
      const fp = b.requirements.find((r) => r.kind === 'footprint');
      expect(fp, b.id).toBeTruthy();
      if (fp?.kind === 'footprint') expect(b.lot.w * b.lot.h, `${b.id} lot`).toBeGreaterThan((fp.maxM2 ?? 0) * 1.2);
      expect(b.budget, b.id).toBeGreaterThan(0);
      expect(Object.values(b.weights).reduce((s, w) => s + w, 0)).toBeCloseTo(1);
    }
  });

  it('has jobs for every tier and a way up from each one', () => {
    for (const t of TIERS) {
      expect(BRIEFS.some((b) => b.tier === t.tier), `tier ${t.tier} jobs`).toBe(true);
      if (t.tier < TIERS.length) expect(t.objectives.length, `tier ${t.tier} objectives`).toBeGreaterThan(0);
      for (const o of t.objectives) {
        if (o.kind === 'flow') expect(BRIEFS.some((b) => b.building === o.building && b.tier <= t.tier), `${t.tier}: ${o.text}`).toBe(true);
        if (o.kind === 'jobs') expect(BRIEFS.filter((b) => b.tier <= t.tier).length, `${t.tier}: ${o.text}`).toBeGreaterThanOrEqual(o.count);
      }
    }
  });
});
