import { describe, expect, it } from 'vitest';
import { findPath } from './astar';
import { runSim } from './engine';
import { cellIndex, createNavGrid } from './navgrid';
import { buildNavGrid, entranceCells, inferBuilding, simulateFlow } from './scenarios';
import { sampleHouse, sampleStore } from '../model/samples';
import { findRooms } from '../model/rooms';
import { checkAllFurniture } from '../model/furniture';
import { createDesign, encloseFootprint, paintFootprint } from '../model/design';

describe('findPath', () => {
  it('goes around a wall through the gap', () => {
    const g = createNavGrid(5, 5);
    // Wall between x=1 and x=2 for rows 0..3; row 4 is open.
    for (let y = 0; y < 4; y++) g.vWall[y * 6 + 2] = 1;
    const p = findPath(g, cellIndex(g, 0, 0), cellIndex(g, 4, 0))!;
    expect(p).not.toBeNull();
    expect(p.cells).toContain(cellIndex(g, 1, 4));
  });

  it('does not cut corners diagonally', () => {
    const g = createNavGrid(2, 2);
    g.blocked[cellIndex(g, 1, 0)] = 1;
    const p = findPath(g, cellIndex(g, 0, 0), cellIndex(g, 1, 1))!;
    expect(p.cells).toEqual([0, 2, 3]);
  });

  it('returns null when sealed off', () => {
    const g = createNavGrid(3, 1);
    g.vWall[1] = 1;
    expect(findPath(g, 0, 2)).toBeNull();
  });
});

describe('runSim', () => {
  it('two people passing head-on in a corridor both get through', () => {
    const g = createNavGrid(10, 1);
    const r = runSim(g, [
      { kind: 'a', start: 0, startTime: 0, goals: [{ cells: [9], dwell: 0, label: 'east' }] },
      { kind: 'b', start: 9, startTime: 0, goals: [{ cells: [0], dwell: 0, label: 'west' }] },
    ]);
    expect(r.outcomes.every((o) => o.finished)).toBe(true);
  });

  it('a busy goal makes others queue', () => {
    const g = createNavGrid(6, 1);
    const goal = { cells: [5], dwell: 10, label: 'the bathroom' };
    const r = runSim(g, [
      { kind: 'a', start: 3, startTime: 0, goals: [goal] },
      { kind: 'b', start: 0, startTime: 0, goals: [goal] },
    ]);
    expect(r.outcomes.every((o) => o.finished)).toBe(true);
    expect(r.waitByLabel['the bathroom']).toBeGreaterThan(5);
    expect(r.frameCount * r.agentCount * 2).toBe(r.frames.length);
  });
});

describe('scenarios', () => {
  it('sample designs follow the placement rules', () => {
    for (const d of [sampleHouse(), sampleStore()]) {
      const rooms = findRooms(d);
      expect(rooms.rooms.every((r) => r.enclosed)).toBe(true);
      const checks = checkAllFurniture(d, rooms);
      const bad = d.furniture.filter((f) => checks.get(f.id)!.errors.length).map((f) => `${d.name}: ${f.item} ${checks.get(f.id)!.errors}`);
      expect(bad).toEqual([]);
    }
  });

  it('infers the building type', () => {
    expect(inferBuilding(sampleHouse(), findRooms(sampleHouse()))).toBe('house');
    expect(inferBuilding(sampleStore(), findRooms(sampleStore()))).toBe('store');
  });

  it('finds the outside cell past each exterior door', () => {
    const d = sampleHouse();
    const g = buildNavGrid(d);
    expect(entranceCells(d, g)).toHaveLength(1);
  });

  it('runs the morning rush in the sample house', () => {
    const d = sampleHouse();
    const r = simulateFlow(d, findRooms(d), 'house');
    expect(r.people).toBe(3);
    expect(r.finished).toBe(3);
    expect(r.score).toBeGreaterThan(20);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('runs shoppers through the sample store', () => {
    const d = sampleStore();
    const r = simulateFlow(d, findRooms(d), 'store');
    expect(r.people).toBe(24);
    expect(r.finished).toBe(24);
    expect(r.score).toBeGreaterThan(20);
  });

  it('is deterministic for a given seed', () => {
    const d = sampleStore();
    expect(simulateFlow(d, findRooms(d), 'store', 7).score).toBe(simulateFlow(d, findRooms(d), 'store', 7).score);
  });

  it('reports a building with no door', () => {
    const d = createDesign('t', 20, 20);
    paintFootprint(d, 2, 2, 8, 8, true);
    encloseFootprint(d);
    const r = simulateFlow(d, findRooms(d), 'house');
    expect(r.score).toBe(0);
    expect(r.issues[0].text).toMatch(/No way in/);
  });
});
