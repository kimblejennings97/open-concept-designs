/** Step-by-step tips: shows the next thing to do on the current design until it's built out. */
import type { Editor } from '../editor/editor';
import { OPENING_SPECS, wallKind, openingEdges } from '../model/design';

export interface CoachState {
  simRun: boolean;
}

/** The next tip for this design, or null once it has everything. */
export function nextTip(editor: Editor, state: CoachState, touch: boolean): string | null {
  const d = editor.design;
  const rooms = editor.getRooms().rooms;
  const tap = touch ? 'Tap' : 'Click';
  if (d.footprint.size === 0) return `Pick Footprint (F) and drag on the lot to outline your building.`;
  if (d.walls.size === 0) return `${tap} “Wall the footprint” in the sidebar to put walls all the way round.`;
  if (rooms.some((r) => !r.enclosed)) return 'Part of the building isn’t walled in (hatched). Close the gaps with the Wall tool (W).';
  const hasEntrance = d.openings.some((o) => OPENING_SPECS[o.kind].isDoor && wallKind(d, openingEdges(o)[0]) === 'exterior');
  if (!hasEntrance) return `Pick Door (D) and ${tap.toLowerCase()} an outside wall to add a way in.`;
  const area = d.footprint.size * 0.25;
  if (rooms.length === 1 && area > 30) return 'Use the Wall tool (W) to split the inside into rooms, then add doors between them.';
  if (rooms.some((r) => r.enclosed && !r.type)) return `Pick Room (O), ${tap.toLowerCase()} each room and choose its type, floor and walls.`;
  if (!d.openings.some((o) => o.kind === 'window')) return 'Add windows (N) on outside walls: rooms need daylight to look good.';
  if (d.furniture.length === 0) return 'Pick Furniture (C) and furnish your rooms from the catalog.';
  if (!state.simRun) return 'Run the simulation in the sidebar to watch people use your building.';
  return null;
}
