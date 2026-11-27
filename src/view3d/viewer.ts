/** Interactive 3D view: orbit camera, soft lighting, cutaway walls, doors you can open, and simulated people. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Design } from '../model/design';
import { CELL_M } from '../model/grid';
import { PHASE_BLOCKED, PHASE_DWELL, type SimResult } from '../sim/engine';
import { type BuiltScene, buildScene } from './build';

export interface SimSource {
  result: SimResult | null;
  time: number;
  kinds: string[];
}

const PHASE_COLORS = { walk: '#3fa9e0', blocked: '#e0504a', dwell: '#e8b43c' };
const SHIRTS = ['#3f7cc4', '#c4573f', '#4aa36b', '#8a5cc4', '#c49a3f', '#3fb3b0'];

export class Viewer3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight('#fff6e8', 2.2);
  private built: BuiltScene | null = null;
  private people: THREE.Group[] = [];
  private markers: THREE.MeshStandardMaterial[] = [];
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  cutaway = true;
  showRoof = false;
  /** Called when a door is tapped open or shut. */
  onDoor: (open: boolean) => void = () => {};
  /** Door openness 0–1 by opening id, and where each is heading. Kept across rebuilds. */
  private readonly doorOpen = new Map<string, number>();
  private readonly doorTarget = new Map<string, number>();
  private readonly raycaster = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private lastTick = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly getSim: () => SimSource | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color('#bcd3e6');
    this.scene.fog = new THREE.Fog('#bcd3e6', 60, 160);
    this.scene.add(new THREE.HemisphereLight('#e8f1ff', '#7a6a55', 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      // A tap (not an orbit drag) on a door swings it.
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) {
        const id = this.doorAt(e);
        if (id) this.toggleDoor(id);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') return;
      el.style.cursor = this.doorAt(e) ? 'pointer' : '';
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** (Re)build the scene for a design and frame the camera on it. */
  show(d: Design): void {
    this.clearBuilding();
    const built = buildScene(d);
    this.built = built;
    this.scene.add(built.root);
    this.applyCutaway();

    const { center, radius } = built;
    this.controls.target.copy(center).setY(0.8);
    this.camera.position.set(center.x + radius * 1.3, radius * 1.9 + 4, center.z + radius * 1.9 + 3);
    this.controls.update();

    // Sun from the south-west, shadow box sized to the building.
    this.sun.position.set(center.x - radius * 1.5 - 8, radius * 2 + 12, center.z + radius + 10);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    const r = radius + 6;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.far = radius * 6 + 60;
    cam.updateProjectionMatrix();

    this.buildPeople();
    if (!this.frame) this.frame = requestAnimationFrame(this.loop);
  }

  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.applyCutaway();
  }

  toggleDoor(id: string): void {
    const open = (this.doorTarget.get(id) ?? 0) < 0.5;
    this.doorTarget.set(id, open ? 1 : 0);
    this.onDoor(open);
  }

  /** Open or shut every door at once. */
  setAllDoors(open: boolean): void {
    for (const leaf of this.built?.doors ?? []) this.doorTarget.set(leaf.id, open ? 1 : 0);
  }

  get anyDoorOpen(): boolean {
    return [...this.doorTarget.values()].some((v) => v > 0.5);
  }

  /** The door under a pointer event, if the first thing hit is a door. */
  private doorAt(e: PointerEvent): string | null {
    if (!this.built?.doors.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [this.built.walls];
    if (this.built.roof.visible) targets.push(this.built.roof);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return (hit?.object.userData.doorId as string | undefined) ?? null;
  }

  private updateDoors(dt: number): void {
    for (const leaf of this.built?.doors ?? []) {
      const target = this.doorTarget.get(leaf.id) ?? 0;
      let v = this.doorOpen.get(leaf.id) ?? 0;
      if (v !== target) {
        v = target > v ? Math.min(target, v + dt * 1.6) : Math.max(target, v - dt * 1.6);
        this.doorOpen.set(leaf.id, v);
      }
      const eased = v * v * (3 - 2 * v);
      leaf.pivot.rotation.y = leaf.closed + leaf.delta * eased;
    }
  }

  setRoof(on: boolean): void {
    this.showRoof = on;
    this.applyCutaway();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver.disconnect();
    this.clearBuilding();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyCutaway(): void {
    // Walls down to waist height so you can see inside (like a dollhouse).
    if (!this.built) return;
    this.built.walls.scale.y = this.cutaway ? 0.38 : 1;
    this.built.roof.visible = this.showRoof && !this.cutaway;
  }

  private clearBuilding(): void {
    if (this.built) {
      this.scene.remove(this.built.root);
      this.built.dispose();
      this.built = null;
    }
    for (const p of this.people) this.scene.remove(p);
    this.people = [];
    for (const m of this.markers) m.dispose();
    this.markers = [];
  }

  private buildPeople(): void {
    const sim = this.getSim();
    const r = sim?.result;
    if (!r) return;
    const body = new THREE.CylinderGeometry(0.17, 0.19, 1.15, 10);
    body.translate(0, 0.62, 0);
    const head = new THREE.SphereGeometry(0.13, 12, 10);
    head.translate(0, 1.38, 0);
    const skin = new THREE.MeshStandardMaterial({ color: '#e2b48f', roughness: 0.8 });
    for (let a = 0; a < r.agentCount; a++) {
      const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[a % SHIRTS.length], roughness: 0.8 });
      // A small status disc under each person: walking, busy or stuck.
      const marker = new THREE.MeshStandardMaterial({ color: PHASE_COLORS.walk, emissive: PHASE_COLORS.walk, emissiveIntensity: 0.4 });
      this.markers.push(shirt, marker);
      const g = new THREE.Group();
      const b = new THREE.Mesh(body, shirt);
      b.castShadow = true;
      const h = new THREE.Mesh(head, skin);
      h.castShadow = true;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16).rotateX(-Math.PI / 2).translate(0, 0.07, 0), marker);
      g.add(b, h, disc);
      g.visible = false;
      g.userData.marker = marker;
      this.people.push(g);
      this.scene.add(g);
    }
    this.markers.push(skin);
  }

  private updatePeople(): void {
    const sim = this.getSim();
    const r = sim?.result;
    if (!r || !this.people.length || r.frameCount === 0) {
      for (const p of this.people) p.visible = false;
      return;
    }
    const f = Math.min(r.frameCount - 1, Math.floor(sim.time / r.dt));
    const f2 = Math.min(r.frameCount - 1, f + 1);
    const t = sim.time / r.dt - f;
    for (let a = 0; a < this.people.length; a++) {
      const g = this.people[a];
      const o = (f * r.agentCount + a) * 2;
      const x = r.frames[o];
      if (Number.isNaN(x)) {
        g.visible = false;
        continue;
      }
      const o2 = (f2 * r.agentCount + a) * 2;
      const x2 = Number.isNaN(r.frames[o2]) ? x : r.frames[o2];
      const y = r.frames[o + 1];
      const y2 = Number.isNaN(r.frames[o2]) ? y : r.frames[o2 + 1];
      const px = (x + (x2 - x) * t) * CELL_M;
      const pz = (y + (y2 - y) * t) * CELL_M;
      g.visible = true;
      // Face the direction of travel.
      if (Math.abs(x2 - x) + Math.abs(y2 - y) > 1e-4) g.rotation.y = Math.atan2(x2 - x, y2 - y);
      // A little bob while walking.
      const phase = r.phases[f * r.agentCount + a];
      const walking = phase !== PHASE_DWELL && phase !== PHASE_BLOCKED;
      g.position.set(px, walking ? Math.abs(Math.sin(sim.time * 9 + a)) * 0.04 : 0, pz);
      const marker = g.userData.marker as THREE.MeshStandardMaterial;
      const hex = phase === PHASE_BLOCKED ? PHASE_COLORS.blocked : phase === PHASE_DWELL ? PHASE_COLORS.dwell : PHASE_COLORS.walk;
      marker.color.set(hex);
      marker.emissive.set(hex);
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    this.controls.update();
    this.updateDoors(dt);
    this.updatePeople();
    this.renderer.render(this.scene, this.camera);
  };
}
