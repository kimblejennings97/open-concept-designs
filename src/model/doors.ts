/**
 * Door looks: a style and a color per door. Doors with no explicit choice get a sensible
 * default (a painted panel front door outside, a plain white door inside).
 */
import { type Design, type Opening, OPENING_SPECS, openingEdges, wallKind } from './design';

export type DoorStyle = 'flush' | 'panel' | 'glass' | 'plank';

export const DOOR_STYLES: Record<DoorStyle, { label: string; extraCost: number; tags: string[] }> = {
  flush: { label: 'Flush', extraCost: 0, tags: ['modern'] },
  panel: { label: 'Panel', extraCost: 150, tags: ['classic', 'cozy'] },
  glass: { label: 'Glass', extraCost: 400, tags: ['modern', 'luxury'] },
  plank: { label: 'Plank', extraCost: 200, tags: ['rustic', 'cozy'] },
};

export const DOOR_COLORS: Array<{ id: string; name: string; color: string }> = [
  { id: 'white', name: 'White', color: '#f1eee7' },
  { id: 'oak', name: 'Oak', color: '#b07a45' },
  { id: 'walnut', name: 'Walnut', color: '#5e3d26' },
  { id: 'charcoal', name: 'Charcoal', color: '#33373d' },
  { id: 'red', name: 'Barn red', color: '#9c2f2a' },
  { id: 'navy', name: 'Navy', color: '#2f4468' },
  { id: 'sage', name: 'Sage', color: '#8aa284' },
  { id: 'mustard', name: 'Mustard', color: '#d0a03a' },
];

const colorById = new Map(DOOR_COLORS.map((c) => [c.id, c]));

export const isDoor = (op: Opening): boolean => OPENING_SPECS[op.kind].isDoor;

export function isExteriorDoor(d: Design, op: Opening): boolean {
  return isDoor(op) && wallKind(d, openingEdges(op)[0]) === 'exterior';
}

export function doorStyle(d: Design, op: Opening): DoorStyle {
  if (op.style && op.style in DOOR_STYLES) return op.style;
  return isExteriorDoor(d, op) ? 'panel' : 'flush';
}

export function doorColorId(d: Design, op: Opening): string {
  if (op.color && colorById.has(op.color)) return op.color;
  return isExteriorDoor(d, op) ? 'red' : 'white';
}

export const doorHex = (d: Design, op: Opening): string => colorById.get(doorColorId(d, op))!.color;

/** A short name for a door, for the sidebar: "Front door", "Bedroom door", … */
export function doorLabel(d: Design, op: Opening, roomNames: string[]): string {
  const kind = op.kind === 'double-door' ? 'double door' : 'door';
  if (isExteriorDoor(d, op)) {
    const first = d.openings.find((o) => isExteriorDoor(d, o));
    return first?.id === op.id ? `Front ${kind}` : `Outside ${kind}`;
  }
  const names = roomNames.filter(Boolean);
  if (!names.length) return `Inside ${kind}`;
  return `${names.join(' / ')} ${kind}`;
}
