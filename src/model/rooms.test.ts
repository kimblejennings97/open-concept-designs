import { describe, expect, it } from 'vitest';
import { addOpening, addWalls, createDesign, encloseFootprint, paintFootprint, removeWalls, restore, snapshot } from './design';
import { edgeKey, lineEdges } from './grid';
import { findRooms, roomFloor, roomWalls, setRoomFloor, setRoomType, setRoomWalls } from './rooms';
import { computeCost } from './cost';

/** 8×4-cell box at (0,0) with an interior wall at x=4: two 4×4 rooms. */
function twoRooms() {
  const d = createDesign('t', 20, 20);
  paintFootprint(d, 0, 0, 7, 3, true);
  encloseFootprint(d);
  addWalls(d, lineEdges(4, 0, 4, 4));
  return d;
}

describe('findRooms', () => {
  it('splits on interior walls', () => {
    const { rooms } = findRooms(twoRooms());
    expect(rooms).toHaveLength(2);
    expect(rooms.every((r) => r.enclosed && r.areaM2 === 4)).toBe(true);
  });

  it('doors do not merge rooms', () => {
    const d = twoRooms();
    addOpening(d, { id: 'a', kind: 'door', o: 'v', x: 4, y: 1, len: 2, flip: false });
    expect(findRooms(d).rooms).toHaveLength(2);
  });

  it('flags areas without a full wall as not enclosed', () => {
    const d = createDesign('t', 20, 20);
    paintFootprint(d, 0, 0, 3, 3, true);
    expect(findRooms(d).rooms[0].enclosed).toBe(false);
    encloseFootprint(d);
    expect(findRooms(d).rooms[0].enclosed).toBe(true);
  });

  it('collects the wall faces inside the room', () => {
    const d = twoRooms();
    const left = findRooms(d).byCell.get('0,0')!;
    // 4 top + 4 bottom + 4 left exterior + 4 on the divider
    expect(left.wallSides).toHaveLength(16);
    expect(left.wallSides).toContain(`${edgeKey('v', 4, 0)}/0`);
  });
});

describe('room data', () => {
  it('type, floor and walls apply to the whole room', () => {
    const d = twoRooms();
    const room = findRooms(d).byCell.get('0,0')!;
    expect(setRoomType(d, room, 'bedroom')).toBe(true);
    setRoomFloor(d, room, 'wood');
    setRoomWalls(d, room, 'paint-sage');
    const again = findRooms(d).byCell.get('3,3')!;
    expect(again.type).toBe('bedroom');
    expect(roomFloor(d, again)).toBe('wood');
    expect(roomWalls(d, again)).toBe('paint-sage');
    // The other room is untouched.
    const right = findRooms(d).byCell.get('5,0')!;
    expect(right.type).toBeUndefined();
    expect(roomFloor(d, right)).toBeNull();
  });

  it('removing a divider merges rooms and keeps one type', () => {
    const d = twoRooms();
    const { byCell } = findRooms(d);
    setRoomType(d, byCell.get('0,0')!, 'bedroom');
    setRoomType(d, byCell.get('5,0')!, 'kitchen');
    removeWalls(d, lineEdges(4, 0, 4, 4));
    const { rooms } = findRooms(d);
    expect(rooms).toHaveLength(1);
    expect(d.roomTypes.size).toBe(1);
    // Wall finishes on the removed divider are dropped too.
    expect([...d.wallFinishes.keys()].some((k) => k.startsWith('v4,'))).toBe(false);
  });

  it('splitting a room keeps the floor on both halves', () => {
    const d = createDesign('t', 20, 20);
    paintFootprint(d, 0, 0, 7, 3, true);
    encloseFootprint(d);
    setRoomFloor(d, findRooms(d).rooms[0], 'tile');
    addWalls(d, lineEdges(4, 0, 4, 4));
    const { rooms } = findRooms(d);
    expect(rooms.map((r) => roomFloor(d, r))).toEqual(['tile', 'tile']);
  });

  it('room data survives save/restore', () => {
    const d = twoRooms();
    const room = findRooms(d).rooms[0];
    setRoomType(d, room, 'living');
    setRoomFloor(d, room, 'carpet');
    const back = restore(snapshot(d));
    expect(findRooms(back).rooms[0].type).toBe('living');
    expect(roomFloor(back, findRooms(back).rooms[0])).toBe('carpet');
  });
});

describe('computeCost', () => {
  it('prices structure, systems and finishes', () => {
    const d = twoRooms();
    const { byCell } = findRooms(d);
    setRoomType(d, byCell.get('0,0')!, 'bathroom');
    setRoomFloor(d, byCell.get('0,0')!, 'tile');
    const c = computeCost(d, findRooms(d).rooms);
    // 8 m² footprint × $1100; 12 m exterior × $650; 2 m interior × $250
    expect(c.structure).toBe(8 * 1100 + 12 * 650 + 2 * 250);
    // One plumbed room + HVAC base + 8 m² × $35
    expect(c.systems).toBe(6000 + 5000 + 8 * 35);
    // 4 m² tile × $70
    expect(c.finishes).toBe(4 * 70);
    expect(c.total).toBe(c.structure + c.systems + c.finishes);
  });
});
