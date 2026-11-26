import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sampleHouse, sampleStore } from '../model/samples';
import { createDesign } from '../model/design';
import { buildScene } from './build';
import { CATALOG } from '../data/catalog';
import { addFurniture } from '../model/furniture';

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function assertFinite(m: THREE.Mesh) {
  const pos = m.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error(`NaN in ${m.name || 'mesh'}`);
}

describe('buildScene', () => {
  it('builds the samples with walls, floors and furniture', () => {
    for (const d of [sampleHouse(), sampleStore()]) {
      const s = buildScene(d);
      const all = meshes(s.root);
      expect(all.length).toBeGreaterThanOrEqual(5); // ground, lot, floors, walls, glass, furniture
      all.forEach(assertFinite);
      expect(meshes(s.walls).length).toBeGreaterThan(0);
      expect(s.radius).toBeGreaterThan(3);
      s.dispose();
    }
  });

  it('copes with an empty lot', () => {
    const s = buildScene(createDesign());
    expect(meshes(s.root).length).toBe(2);
    s.dispose();
  });

  it('has a model for every catalog item in every rotation', () => {
    const d = createDesign('t', 60, 60);
    let x = 1;
    for (const item of CATALOG) {
      for (const rot of [0, 1, 2, 3] as const) addFurniture(d, { id: `${item.id}-${rot}`, item: item.id, x, y: 1 + rot * 8, rot });
      x += 7;
      if (x > 50) x = 1;
    }
    const s = buildScene(d);
    meshes(s.root).forEach(assertFinite);
    s.dispose();
  });
});
