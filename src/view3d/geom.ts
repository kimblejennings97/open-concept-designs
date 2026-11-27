/** Small geometry helpers shared by the 3D builders. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const color = new THREE.Color();

/** A box from (x0,y0,z0) to (x1,y1,z1) with a vertex color, for merging. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  color.set(hex);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = color.r;
    cols[i * 3 + 1] = color.g;
    cols[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

export function merged(parts: THREE.BufferGeometry[], material: THREE.Material, shadows = true): THREE.Mesh | null {
  if (!parts.length) return null;
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) return null;
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

