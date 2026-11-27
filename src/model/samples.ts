/**
 * Ready-made sample designs: a starting point on a phone, and fixtures for tests.
 * Built with the same functions the editor uses, so they always follow the rules.
 */
import {
  type Design,
  type Opening,
  type OpeningKind,
  addOpening,
  addTransitions,
  addWalls,
  createDesign,
  encloseFootprint,
  newId,
  paintFootprint,
} from './design';
import { type Rotation, addFurniture } from './furniture';
import { cellKey, lineEdges } from './grid';
import { findRooms, setRoomFloor, setRoomType, setRoomWalls } from './rooms';

export type SampleId = 'house' | 'store' | 'bistro' | 'club' | 'apartments';

export const SAMPLES: Array<{ id: SampleId; name: string }> = [
  { id: 'house', name: 'Sample: two-bedroom house' },
  { id: 'store', name: 'Sample: corner store' },
  { id: 'bistro', name: 'Sample: bistro' },
  { id: 'club', name: 'Sample: nightclub' },
  { id: 'apartments', name: 'Sample: apartment building' },
];

function opening(d: Design, kind: OpeningKind, o: 'h' | 'v', x: number, y: number, len: number, flip = false) {
  const op: Opening = { id: newId(), kind, o, x, y, len, flip };
  addOpening(d, op);
}

function room(d: Design, x: number, y: number, type: string, floor: string, walls: string) {
  const r = findRooms(d).byCell.get(cellKey(x, y));
  if (!r) return;
  setRoomType(d, r, type);
  setRoomFloor(d, r, floor);
  setRoomWalls(d, r, walls);
}

function place(d: Design, item: string, x: number, y: number, rot: Rotation = 0) {
  addFurniture(d, { id: newId(), item, x, y, rot });
}

/** 12 m × 8 m: two bedrooms, a bathroom, and a kitchen open to an L-shaped living room. */
export function sampleHouse(): Design {
  const d = createDesign('Sample house', 40, 30);
  paintFootprint(d, 4, 4, 27, 19, true);
  encloseFootprint(d);
  addWalls(d, lineEdges(14, 4, 14, 20)); // bedrooms | living
  addWalls(d, lineEdges(4, 12, 14, 12)); // bedroom 1 / bottom row
  addWalls(d, lineEdges(9, 12, 9, 20)); // bathroom | bedroom 2
  addWalls(d, lineEdges(20, 4, 20, 12)); // living | kitchen
  addTransitions(d, lineEdges(20, 12, 28, 12)); // open kitchen / living

  opening(d, 'door', 'h', 22, 20, 2, true); // front door, swings in
  opening(d, 'door', 'v', 14, 8, 2, true); // bedroom 1
  opening(d, 'door', 'v', 14, 16, 2, true); // bedroom 2
  opening(d, 'door', 'h', 6, 12, 2); // bathroom (from bedroom 1)
  opening(d, 'window', 'h', 7, 4, 3);
  opening(d, 'window', 'h', 10, 20, 3);
  opening(d, 'window', 'v', 4, 14, 2);
  opening(d, 'window', 'h', 23, 4, 3);
  opening(d, 'window', 'h', 15, 20, 3);
  opening(d, 'window', 'v', 28, 14, 4);

  room(d, 5, 5, 'bedroom', 'wood', 'paint-sage');
  room(d, 10, 13, 'bedroom', 'carpet', 'paint-greige');
  room(d, 5, 13, 'bathroom', 'tile', 'wall-tile');
  room(d, 21, 5, 'kitchen', 'tile', 'paint-white');
  room(d, 15, 15, 'living', 'wood', 'paint-greige');

  place(d, 'bed-double', 7, 4);
  place(d, 'nightstand', 11, 4);
  place(d, 'wardrobe', 4, 7, 3);
  place(d, 'bed-single', 12, 12);
  place(d, 'toilet', 4, 12);
  place(d, 'vanity', 6, 19, 2);
  place(d, 'fridge', 20, 4);
  place(d, 'stove', 22, 4);
  place(d, 'counter', 24, 4);
  place(d, 'kitchen-sink', 26, 4);
  place(d, 'sofa', 15, 13);
  place(d, 'tv-stand', 15, 19, 2);
  place(d, 'rug-large', 15, 15);
  place(d, 'plant', 27, 19);
  place(d, 'dining-table', 23, 13);
  return d;
}

/** 14 m × 9 m: sales floor with aisles and coolers, a checkout, a stockroom and a restroom. */
export function sampleStore(): Design {
  const d = createDesign('Sample store', 40, 30);
  paintFootprint(d, 5, 5, 32, 22, true);
  d.roof = { style: 'flat', pitch: 25, material: 'membrane', turned: false };
  encloseFootprint(d);
  addWalls(d, lineEdges(13, 5, 13, 11)); // stockroom side
  addWalls(d, lineEdges(5, 11, 13, 11)); // stockroom front
  addWalls(d, lineEdges(27, 5, 27, 10)); // restroom side
  addWalls(d, lineEdges(27, 10, 33, 10)); // restroom front

  opening(d, 'double-door', 'h', 18, 23, 4); // entrance
  opening(d, 'door', 'h', 8, 11, 2); // stockroom
  opening(d, 'door', 'h', 29, 10, 2); // restroom
  opening(d, 'window', 'h', 8, 23, 6);
  opening(d, 'window', 'h', 25, 23, 6);

  room(d, 15, 15, 'sales-floor', 'vinyl', 'paint-white');
  room(d, 6, 6, 'stockroom', 'concrete', 'paint-greige');
  room(d, 28, 6, 'restroom', 'tile', 'wall-tile');

  place(d, 'wall-shelf', 14, 5);
  place(d, 'fridge-case', 18, 5);
  place(d, 'fridge-case', 22, 5);
  place(d, 'shelf-aisle', 15, 12, 1);
  place(d, 'shelf-aisle', 21, 12, 1);
  place(d, 'shelf-aisle', 27, 12, 1);
  place(d, 'checkout-counter', 23, 18);
  place(d, 'impulse-rack', 22, 21);
  place(d, 'coffee-station', 6, 22, 2);
  place(d, 'stock-rack', 5, 5);
  place(d, 'toilet', 28, 5);
  place(d, 'vanity', 30, 5);
  place(d, 'plant', 31, 21);
  return d;
}

/** 14 m × 9 m bistro: dining room with a host stand, a commercial kitchen and a restroom. */
export function sampleBistro(): Design {
  const d = createDesign('Sample bistro', 40, 30);
  paintFootprint(d, 4, 4, 31, 21, true);
  d.roof = { style: 'gable', pitch: 25, material: 'clay', turned: false };
  encloseFootprint(d);
  addWalls(d, lineEdges(14, 4, 14, 14)); // kitchen | dining
  addWalls(d, lineEdges(4, 14, 14, 14)); // kitchen bottom
  addWalls(d, lineEdges(4, 16, 10, 16)); // restroom top
  addWalls(d, lineEdges(10, 16, 10, 22)); // restroom side

  opening(d, 'double-door', 'h', 20, 22, 4, true); // entrance
  opening(d, 'door', 'v', 14, 10, 2); // kitchen
  opening(d, 'door', 'h', 6, 16, 2); // restroom
  opening(d, 'window', 'h', 18, 4, 4);
  opening(d, 'window', 'h', 26, 22, 4);
  opening(d, 'window', 'v', 32, 8, 4);

  room(d, 20, 10, 'dining-area', 'wood', 'brick');
  room(d, 5, 5, 'pro-kitchen', 'tile', 'wall-tile');
  room(d, 5, 18, 'restroom', 'tile', 'wall-tile');

  place(d, 'host-stand', 17, 19);
  for (const [x, y] of [[16, 6], [21, 6], [26, 6], [26, 12]]) place(d, 'table-4', x, y);
  for (const [x, y] of [[16, 12], [20, 12], [21, 16], [25, 17]]) place(d, 'table-2', x, y);
  place(d, 'pro-range', 4, 4);
  place(d, 'dish-station', 9, 4);
  place(d, 'prep-table', 6, 10);
  place(d, 'toilet', 8, 16);
  place(d, 'vanity', 4, 21, 2);
  place(d, 'plant', 31, 21);
  return d;
}

/** 20 m × 15 m club: a dance floor open to the bar, a lobby with coat check, restrooms and a stockroom. */
export function sampleClub(): Design {
  const d = createDesign('Sample nightclub', 52, 40);
  paintFootprint(d, 4, 4, 43, 33, true);
  d.roof = { style: 'flat', pitch: 25, material: 'membrane', turned: false };
  encloseFootprint(d);
  addWalls(d, lineEdges(4, 26, 44, 26)); // back-of-house row
  addTransitions(d, lineEdges(32, 4, 32, 26)); // dance floor open to the bar
  addWalls(d, lineEdges(10, 26, 10, 34)); // coat check | lobby
  addWalls(d, lineEdges(22, 26, 22, 34)); // lobby | restroom A
  addWalls(d, lineEdges(28, 26, 28, 34)); // restroom A | B
  addWalls(d, lineEdges(34, 26, 34, 34)); // restroom B | stockroom

  opening(d, 'double-door', 'h', 14, 34, 4, true); // entrance
  opening(d, 'double-door', 'h', 14, 26, 4, true); // lobby → dance floor
  opening(d, 'door', 'v', 10, 27, 2); // coat check
  opening(d, 'door', 'v', 22, 28, 2, true); // restroom A from the lobby
  opening(d, 'door', 'h', 31, 26, 2, true); // restroom B from the dance floor
  opening(d, 'door', 'h', 38, 26, 2, true); // stockroom from the bar

  room(d, 15, 15, 'dance-floor', 'concrete', 'acoustic');
  room(d, 38, 14, 'bar', 'concrete', 'brick');
  room(d, 5, 30, 'coat-check', 'concrete', 'paint-navy');
  room(d, 15, 31, 'lobby', 'concrete', 'brick');
  room(d, 24, 31, 'restroom', 'tile', 'wall-tile');
  room(d, 30, 31, 'restroom', 'tile', 'wall-tile');
  room(d, 38, 31, 'stockroom', 'concrete', 'paint-greige');

  place(d, 'dj-booth', 16, 5);
  for (const [x, y] of [[12, 5], [21, 5], [4, 4], [31, 4]]) place(d, 'speaker', x, y);
  for (const [x, y] of [[5, 20], [9, 20], [25, 20], [28, 16]]) place(d, 'high-top', x, y);
  place(d, 'back-bar', 35, 4);
  place(d, 'bar-counter', 35, 8);
  place(d, 'bar-counter', 35, 18);
  place(d, 'coat-counter', 10, 30, 3);
  place(d, 'toilet', 24, 27);
  place(d, 'toilet', 26, 27);
  place(d, 'vanity', 22, 33, 2);
  place(d, 'toilet', 28, 27);
  place(d, 'toilet', 30, 27);
  place(d, 'stock-rack', 40, 27);
  place(d, 'mirror-ball', 17, 14);
  return d;
}

/** 24 m × 12 m: four one-bedroom flats off a central lobby with mailboxes. */
export function sampleApartments(): Design {
  const d = createDesign('Sample apartments', 60, 36);
  paintFootprint(d, 4, 4, 51, 27, true);
  d.roof = { style: 'hip', pitch: 25, material: 'asphalt', turned: false };
  encloseFootprint(d);
  addWalls(d, lineEdges(4, 14, 52, 14));
  addWalls(d, lineEdges(4, 18, 52, 18));
  addWalls(d, lineEdges(28, 4, 28, 14));
  addWalls(d, lineEdges(28, 18, 28, 28));
  opening(d, 'double-door', 'v', 4, 15, 2); // main entrance
  opening(d, 'door', 'v', 52, 15, 2, true); // side entrance
  room(d, 10, 16, 'lobby', 'tile', 'paint-white');
  place(d, 'mailboxes', 8, 17, 2);
  place(d, 'mailboxes', 34, 17, 2);

  // [bath 2 m][bedroom 4 m][living 4 m | open kitchen 2 m], 5 m deep.
  for (const x0 of [4, 28]) {
    for (const top of [true, false]) {
      const y0 = top ? 4 : 18;
      addWalls(d, lineEdges(x0 + 4, y0, x0 + 4, y0 + 10));
      addWalls(d, lineEdges(x0 + 12, y0, x0 + 12, y0 + 10));
      addTransitions(d, lineEdges(x0 + 20, y0, x0 + 20, y0 + 10));
      opening(d, 'door', 'v', x0 + 4, y0 + (top ? 6 : 2), 2);
      opening(d, 'door', 'v', x0 + 12, y0 + (top ? 6 : 2), 2, true);
      opening(d, 'door', 'h', x0 + 14, top ? 14 : 18, 2, top);
      opening(d, 'window', 'h', x0 + 6, top ? 4 : 28, 3);
      opening(d, 'window', 'h', x0 + 15, top ? 4 : 28, 3);
      room(d, x0 + 1, y0 + 5, 'bathroom', 'tile', 'wall-tile');
      room(d, x0 + 8, y0 + 5, 'bedroom', 'carpet', 'paint-greige');
      room(d, x0 + 16, y0 + 5, 'living', 'vinyl', 'paint-white');
      room(d, x0 + 21, y0 + 5, 'kitchen', 'tile', 'paint-white');
      const r = top ? 0 : 2;
      const yy = (row: number, h: number) => (top ? y0 + row : y0 + 10 - row - h);
      place(d, 'bed-double', x0 + 6, yy(0, 4), r);
      place(d, 'toilet', x0 + 1, yy(0, 2), r);
      place(d, 'vanity', x0 + 2, yy(0, 1), r);
      place(d, 'kitchen-sink', x0 + 20, yy(0, 2), r);
      place(d, 'fridge', x0 + 22, yy(0, 2), r);
      place(d, 'sofa', x0 + 14, yy(2, 2), r);
    }
  }
  return d;
}

const BUILDERS: Record<SampleId, () => Design> = {
  house: sampleHouse,
  store: sampleStore,
  bistro: sampleBistro,
  club: sampleClub,
  apartments: sampleApartments,
};

export function sampleDesign(id: SampleId): Design {
  return (BUILDERS[id] ?? sampleHouse)();
}
