/**
 * Door leaves for the 3D view. Each leaf hangs on its own pivot at the hinge, so the
 * viewer can swing it open (rotation.y = closed + delta × openness) when it's tapped.
 * Swing side and hinge match the blueprint's door symbol.
 */
import * as THREE from 'three';
import { type Design, openingEdges, wallKind } from '../model/design';
import { type DoorStyle, doorHex, doorStyle, isDoor } from '../model/doors';
import { CELL_M } from '../model/grid';
import { box, merged } from './geom';

export interface DoorLeaf {
  /** Opening id; both leaves of a double door share it. */
  id: string;
  pivot: THREE.Group;
  /** Pivot rotation when shut, and the extra rotation when fully open (±90°). */
  closed: number;
  delta: number;
}

const LEAF_T = 0.045;
const TRIM = '#f4f1ea';
const BRASS = '#c9a45a';

function shade(hex: string, k: number): string {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

/** Boxes for one leaf in its own frame: x from hinge (0) to free edge (w), y up, z across. */
function leafParts(style: DoorStyle, w: number, h: number, hex: string): { solid: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[] } {
  const T = LEAF_T / 2;
  const solid: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const both = (x0: number, y0: number, x1: number, y1: number, depth: number, col: string) => {
    solid.push(box(x0, y0, T, x1, y1, T + depth, col));
    solid.push(box(x0, y0, -T - depth, x1, y1, -T, col));
  };
  if (style === 'glass') {
    const s = Math.min(0.1, w * 0.15);
    solid.push(box(0, 0, -T, s, h, T, hex), box(w - s, 0, -T, w, h, T, hex));
    solid.push(box(s, h - s, -T, w - s, h, T, hex), box(s, 0, -T, w - s, 0.25, T, hex));
    solid.push(box(s, h * 0.55 - 0.02, -T * 0.6, w - s, h * 0.55 + 0.02, T * 0.6, hex)); // muntin
    glass.push(box(s, 0.25, -0.006, w - s, h - s, 0.006, '#ffffff'));
  } else {
    solid.push(box(0, 0, -T, w, h, T, hex));
    if (style === 'panel') {
      // Six raised panels, two columns by three rows.
      const m = Math.min(0.09, w * 0.12);
      const cw = (w - 3 * m) / 2;
      const rows = [
        [0.12, 0.8],
        [0.92, 1.45],
        [1.57, h - 0.12],
      ];
      for (const [y0, y1] of rows) for (const c of [0, 1]) both(m + c * (cw + m), y0, m + c * (cw + m) + cw, y1, 0.008, shade(hex, 0.88));
    } else if (style === 'plank') {
      for (let x = 0.12; x < w - 0.05; x += 0.12) both(x - 0.004, 0.02, x + 0.004, h - 0.02, 0.003, shade(hex, 0.7));
      for (const y of [0.25, h / 2, h - 0.3]) both(0.04, y - 0.06, w - 0.04, y + 0.06, 0.012, shade(hex, 0.85));
    }
  }
  // Handle on both faces, near the free edge.
  both(w - 0.11, 0.98, w - 0.06, 1.03, 0.05, BRASS);
  return { solid, glass };
}

export function doorLeaves(
  d: Design,
  opts: { solid: THREE.Material; glass: THREE.Material; doorH: number; extT: number; intT: number },
): { group: THREE.Group; leaves: DoorLeaf[]; geometries: THREE.BufferGeometry[] } {
  const group = new THREE.Group();
  const leaves: DoorLeaf[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];

  for (const op of d.openings) {
    if (!isDoor(op)) continue;
    const t = wallKind(d, openingEdges(op)[0]) === 'exterior' ? opts.extT : opts.intT;
    const ax = op.o === 'h' ? 1 : 0;
    const ay = op.o === 'h' ? 0 : 1;
    const side = op.flip ? -1 : 1;
    const nx = op.o === 'h' ? 0 : side;
    const ny = op.o === 'h' ? side : 0;
    const ex = op.x + ax * op.len;
    const ey = op.y + ay * op.len;
    const style = doorStyle(d, op);
    const hex = doorHex(d, op);

    // Casing: jambs and a head on both faces of the wall.
    const cw = 0.07;
    const x0 = op.x * CELL_M;
    const z0 = op.y * CELL_M;
    const x1 = ex * CELL_M;
    const z1 = ey * CELL_M;
    const f = t / 2 + 0.012;
    if (op.o === 'h') {
      trim.push(box(x0 - cw, 0, z0 - f, x0, opts.doorH + cw, z0 + f, TRIM), box(x1, 0, z0 - f, x1 + cw, opts.doorH + cw, z0 + f, TRIM));
      trim.push(box(x0, opts.doorH, z0 - f, x1, opts.doorH + cw, z0 + f, TRIM));
    } else {
      trim.push(box(x0 - f, 0, z0 - cw, x0 + f, opts.doorH + cw, z0, TRIM), box(x0 - f, 0, z1, x0 + f, opts.doorH + cw, z1 + cw, TRIM));
      trim.push(box(x0 - f, opts.doorH, z0, x0 + f, opts.doorH + cw, z1, TRIM));
    }

    const hinges =
      op.kind === 'double-door'
        ? [
            { hx: op.x, hy: op.y, dx: ax, dy: ay, r: op.len / 2 },
            { hx: ex, hy: ey, dx: -ax, dy: -ay, r: op.len / 2 },
          ]
        : [{ hx: op.x, hy: op.y, dx: ax, dy: ay, r: op.len }];
    for (const hg of hinges) {
      const w = hg.r * CELL_M - 0.015;
      const parts = leafParts(style, w, opts.doorH - 0.01, hex);
      const pivot = new THREE.Group();
      const leafMesh = merged(parts.solid, opts.solid);
      if (leafMesh) {
        leafMesh.userData.doorId = op.id;
        pivot.add(leafMesh);
        geometries.push(leafMesh.geometry);
      }
      if (parts.glass.length) {
        const g = merged(parts.glass, opts.glass, false);
        if (g) {
          g.userData.doorId = op.id;
          pivot.add(g);
          geometries.push(g.geometry);
        }
      }
      // Hinge at the wall face on the swing side, so the open leaf lies against the room.
      const inset = t / 2 - LEAF_T / 2;
      pivot.position.set((hg.hx + nx * (inset / CELL_M)) * CELL_M + hg.dx * 0.008, 0, (hg.hy + ny * (inset / CELL_M)) * CELL_M + hg.dy * 0.008);
      const closed = Math.atan2(-hg.dy, hg.dx);
      let delta = Math.atan2(-ny, nx) - closed;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      pivot.rotation.y = closed;
      group.add(pivot);
      leaves.push({ id: op.id, pivot, closed, delta });
    }
  }
  const trimMesh = merged(trim, opts.solid);
  if (trimMesh) {
    group.add(trimMesh);
    geometries.push(trimMesh.geometry);
  }
  return { group, leaves, geometries };
}
