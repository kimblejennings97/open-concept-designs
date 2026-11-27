/**
 * Roof geometry. Each roof section (see model/roof.ts roofPlan) becomes a few sloped planes
 * plus wall infill under it (gable triangles, the tall side of a shed roof). Sections overlap
 * on L- and T-shaped plans and simply intersect, which reads as valleys and cross-gables.
 */
import * as THREE from 'three';
import { roofMaterial } from '../data/catalog';
import { type Design, wallKind } from '../model/design';
import { CELL_M, edgeKey, parseCell } from '../model/grid';
import { EAVE_M, type RoofRect, effectivePitch, roofPlan, shedHighAtStart } from '../model/roof';

const INFILL = '#e9e4da'; // matches exterior walls
const FASCIA = '#f4f1ea';
const FLAT_SLAB = 0.22;
const PARAPET_H = 0.45;
const PARAPET_T = 0.2;

/** Collects triangles with a color each, then makes one non-indexed geometry. */
class TriBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new THREE.Color();

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, hex: string): void {
    this.c.set(hex);
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, hex: string): void {
    this.tri(a, b, c, hex);
    this.tri(a, c, d, hex);
  }

  /** Axis-aligned box (all six faces). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string): void {
    const v = (x: number, y: number, z: number) => ({ x, y, z });
    this.quad(v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), hex); // top
    this.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), hex); // bottom
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), hex); // south
    this.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), hex); // north
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), hex); // west
    this.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), hex); // east
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * One pitched section, written in local coordinates: u runs along the ridge, v across it.
 * `emit` maps (u, height, v) to world space for the section's axis.
 */
function pitchedSection(
  out: TriBuilder,
  r: RoofRect,
  style: 'gable' | 'hip' | 'shed',
  t: number,
  base: number,
  roofHex: string,
  shedHighAtV0: boolean,
): void {
  const along = r.axis === 'x';
  const U0 = (along ? r.x0 : r.y0) * CELL_M;
  const U1 = (along ? r.x1 : r.y1) * CELL_M;
  const V0 = (along ? r.y0 : r.x0) * CELL_M;
  const V1 = (along ? r.y1 : r.x1) * CELL_M;
  const P = (u: number, h: number, v: number) => (along ? { x: u, y: h, z: v } : { x: v, y: h, z: u });
  const o = EAVE_M;
  const eave = base - o * t;

  if (style === 'shed') {
    // High along one long edge, falling across the section.
    const span = V1 - V0;
    const top = base + span * t;
    const hi = shedHighAtV0 ? V0 : V1;
    const lo = shedHighAtV0 ? V1 : V0;
    const dir = shedHighAtV0 ? -1 : 1; // from the low side toward the high side
    const hiOut = hi + dir * o;
    const loOut = lo - dir * o;
    out.quad(P(U0 - o, top + o * t, hiOut), P(U1 + o, top + o * t, hiOut), P(U1 + o, eave, loOut), P(U0 - o, eave, loOut), roofHex);
    // Tall wall under the high edge, and the triangles on each end.
    out.quad(P(U0, base, hi), P(U1, base, hi), P(U1, top, hi), P(U0, top, hi), INFILL);
    out.tri(P(U0, base, hi), P(U0, base, lo), P(U0, top, hi), INFILL);
    out.tri(P(U1, base, hi), P(U1, base, lo), P(U1, top, hi), INFILL);
    return;
  }

  const vc = (V0 + V1) / 2;
  const ridge = base + ((V1 - V0) / 2) * t;
  if (style === 'gable') {
    out.quad(P(U0 - o, eave, V0 - o), P(U1 + o, eave, V0 - o), P(U1 + o, ridge, vc), P(U0 - o, ridge, vc), roofHex);
    out.quad(P(U0 - o, eave, V1 + o), P(U1 + o, eave, V1 + o), P(U1 + o, ridge, vc), P(U0 - o, ridge, vc), roofHex);
    out.tri(P(U0, base, V0), P(U0, base, V1), P(U0, ridge, vc), INFILL);
    out.tri(P(U1, base, V0), P(U1, base, V1), P(U1, ridge, vc), INFILL);
    // Thin bargeboards along the sloped ends.
    for (const u of [U0 - o, U1 + o]) {
      out.quad(P(u, eave, V0 - o), P(u, ridge, vc), P(u, ridge - 0.12, vc), P(u, eave - 0.12, V0 - o), FASCIA);
      out.quad(P(u, eave, V1 + o), P(u, ridge, vc), P(u, ridge - 0.12, vc), P(u, eave - 0.12, V1 + o), FASCIA);
    }
    return;
  }

  // Hip: the ridge is inset from both ends by the half-span, so all four slopes match.
  const S = (V1 - V0) / 2 + o;
  const mid = (U0 + U1) / 2;
  const r0 = Math.min(U0 - o + S, mid);
  const r1 = Math.max(U1 + o - S, mid);
  out.quad(P(U0 - o, eave, V0 - o), P(U1 + o, eave, V0 - o), P(r1, ridge, vc), P(r0, ridge, vc), roofHex);
  out.quad(P(U0 - o, eave, V1 + o), P(U1 + o, eave, V1 + o), P(r1, ridge, vc), P(r0, ridge, vc), roofHex);
  out.tri(P(U0 - o, eave, V0 - o), P(U0 - o, eave, V1 + o), P(r0, ridge, vc), roofHex);
  out.tri(P(U1 + o, eave, V0 - o), P(U1 + o, eave, V1 + o), P(r1, ridge, vc), roofHex);
}

/** Roof geometry for a design, sitting on walls `wallH` meters tall. Null if there's no building. */
export function roofGeometry(d: Design, wallH: number): THREE.BufferGeometry | null {
  if (!d.footprint.size) return null;
  const out = new TriBuilder();
  const roof = d.roof;
  const hex = roofMaterial(roof.material)?.color ?? '#4a4f57';

  if (roof.style === 'flat') {
    // A deck over every cell and a parapet along every outside edge.
    for (const k of d.footprint) {
      const [x, y] = parseCell(k);
      out.quad(
        { x: x * CELL_M, y: wallH + FLAT_SLAB, z: y * CELL_M },
        { x: x * CELL_M, y: wallH + FLAT_SLAB, z: (y + 1) * CELL_M },
        { x: (x + 1) * CELL_M, y: wallH + FLAT_SLAB, z: (y + 1) * CELL_M },
        { x: (x + 1) * CELL_M, y: wallH + FLAT_SLAB, z: y * CELL_M },
        hex,
      );
      const edges: Array<[string, number, number, number, number]> = [
        [edgeKey('h', x, y), x, y, x + 1, y],
        [edgeKey('h', x, y + 1), x, y + 1, x + 1, y + 1],
        [edgeKey('v', x, y), x, y, x, y + 1],
        [edgeKey('v', x + 1, y), x + 1, y, x + 1, y + 1],
      ];
      for (const [key, ax, ay, bx, by] of edges) {
        if (wallKind(d, key) !== 'exterior') continue;
        const h = PARAPET_T / 2;
        out.box(ax * CELL_M - h, wallH, ay * CELL_M - h, bx * CELL_M + h, wallH + FLAT_SLAB + PARAPET_H, by * CELL_M + h, INFILL);
      }
    }
    return out.build();
  }

  const t = Math.tan((effectivePitch(roof) * Math.PI) / 180);
  const rects = roofPlan(d.footprint, roof);
  rects.forEach((r, i) => {
    // A hair of height per section keeps overlapping, coplanar slopes from flickering.
    pitchedSection(out, r, roof.style as 'gable' | 'hip' | 'shed', t, wallH + i * 0.004, hex, shedHighAtStart(roof));
  });
  return out.empty ? null : out.build();
}
