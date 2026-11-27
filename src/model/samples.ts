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

export type SampleId = 'house' | 'store';

export const SAMPLES: Array<{ id: SampleId; name: string }> = [
  { id: 'house', name: 'Sample: two-bedroom house' },
  { id: 'store', name: 'Sample: corner store' },
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

export function sampleDesign(id: SampleId): Design {
  return id === 'house' ? sampleHouse() : sampleStore();
}
