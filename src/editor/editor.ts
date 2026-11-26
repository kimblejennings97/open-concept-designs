import {
  type Design,
  type Opening,
  OPENING_SPECS,
  addOpening,
  addWalls,
  openingEdges,
  openingOnEdge,
  openingProblem,
  paintFootprint,
  removeOpening,
  removeWalls,
  restore,
  snapshot,
  wallKind,
  edgeInLot,
  newId,
} from '../model/design';
import { type Edge, cellKey, edgeKey, fmtMeters, lineEdges, nearestEdge, parseCell, parseEdge } from '../model/grid';
import { type Room, type RoomMap, findRooms, parseSideKey } from '../model/rooms';
import { type CatalogItem, catalogItem, floorMaterial, roomType, wallFinish } from '../data/catalog';
import {
  type Furniture,
  type FurnitureCheck,
  type Rotation,
  addFurniture,
  checkAllFurniture,
  checkFurniture,
  clearanceCells,
  furnitureAt,
  nextRotation,
  removeFurniture,
  rotatedSize,
  updateFurniture,
} from '../model/furniture';
import { History } from './history';
import type { FlowReport } from '../sim/scenarios';
import { PHASE_BLOCKED, PHASE_DWELL } from '../sim/engine';

export type ToolId = 'footprint' | 'wall' | 'door' | 'window' | 'room' | 'furniture' | 'erase';
export type DoorKind = 'door' | 'double-door';

export const TOOL_HINTS: Record<ToolId, string> = {
  footprint: 'Drag to paint the building footprint. Right-drag (or Shift-drag) to clear.',
  wall: 'Drag between grid points to draw a wall. Right-drag (or Shift-drag) to remove walls.',
  door: 'Click a wall to place a door. R flips the swing. Right-click a door to remove it.',
  window: 'Click an exterior wall to place a window. [ and ] change the width. Right-click to remove.',
  room: 'Click a room to select it, then set its type, flooring and wall finish in the sidebar. Esc deselects.',
  furniture: 'Pick an item from the catalog, then click to place it. R rotates. Drag a placed item to move it; right-click or Delete removes it.',
  erase: 'Click or drag over furniture, doors, windows and walls to remove them.',
};

const MIN_SCALE = 4;
const MAX_SCALE = 120;
const EDGE_PICK = 0.45; // cells

const COLORS = {
  outside: '#0b1726',
  lot: '#13294a',
  gridMinor: 'rgba(160, 200, 255, 0.07)',
  gridMeter: 'rgba(160, 200, 255, 0.16)',
  gridFive: 'rgba(160, 200, 255, 0.3)',
  lotBorder: 'rgba(200, 225, 255, 0.65)',
  footprint: 'rgba(110, 170, 255, 0.24)',
  wallExt: '#f1f5fb',
  wallInt: '#a9c0e0',
  window: '#7fd4ff',
  door: '#ffcf70',
  ok: 'rgba(110, 230, 150, 0.95)',
  bad: 'rgba(255, 105, 105, 0.95)',
  okFill: 'rgba(110, 230, 150, 0.22)',
  badFill: 'rgba(255, 105, 105, 0.22)',
  labelBg: 'rgba(8, 16, 28, 0.85)',
  labelText: '#e8f0fb',
  labelHalo: 'rgba(8, 16, 28, 0.8)',
  muted: '#9fb2cc',
  warn: '#ffcf70',
  openHatch: 'rgba(255, 207, 112, 0.35)',
  selected: '#ffcf70',
  hover: 'rgba(255, 207, 112, 0.5)',
  clearance: 'rgba(255, 255, 255, 0.06)',
  person: '#5ec8ff',
};

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'rect'; add: boolean; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; add: boolean; ax: number; ay: number; bx: number; by: number }
  | { kind: 'erase'; before: string; changed: boolean; layer: 'furniture' | 'opening' | 'wall' | null }
  | { kind: 'tap'; remove: boolean }
  | { kind: 'move'; id: string; offX: number; offY: number; before: string; ox: number; oy: number };

export class Editor {
  design: Design;
  readonly history = new History();

  tool: ToolId = 'footprint';
  doorKind: DoorKind = 'door';
  windowLen = OPENING_SPECS.window.defaultLen;
  doorFlip = false;
  /** Catalog item the Furniture tool will place, if any. */
  armedItem: string | null = null;
  furnitureRot: Rotation = 0;
  /** Selected furniture piece id. */
  selectedFurnitureId: string | null = null;
  /** Latest flow simulation (cleared when the design changes). */
  sim: FlowReport | null = null;
  /** Playback position in sim seconds. */
  simTime = 0;
  simPlaying = false;
  simSpeed = 4;
  showHeat = true;
  private simLast = 0;
  private simFrame = 0;

  /** Touch-friendly stand-in for right-click: the current tool removes instead of adds. */
  removeMode = false;

  /** Short message about the current hover (e.g. why a door can't go here). */
  message = '';
  /** Pointer position in cells, or null when off-canvas. */
  pointer: { wx: number; wy: number } | null = null;

  /** Sound effect hook (set by the page). */
  sound: (cue: 'place' | 'draw' | 'remove' | 'error') => void = () => {};

  /** Called after anything changes. `designChanged` is true when the design itself was edited. */
  onChange: (designChanged: boolean) => void = () => {};

  private readonly ctx: CanvasRenderingContext2D;
  private cam = { scale: 20, ox: 0, oy: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private drag: Drag | null = null;
  private spaceHeld = false;
  private shiftHeld = false;
  private frame = 0;
  /** Bumped on every design edit; keys the room cache. */
  private rev = 0;
  private roomCache: { rev: number; map: RoomMap } | null = null;
  private checkCache: { rev: number; map: Map<string, FurnitureCheck> } | null = null;
  /** A cell inside the selected room (cells survive edits better than room objects). */
  private selectedCell: string | null = null;
  /** Pointers currently pressed (screen coords), for two-finger pan/zoom. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; mx: number; my: number; scale: number; ox: number; oy: number } | null = null;
  /** After a pinch, ignore remaining fingers until all are lifted. */
  private gestureLock = false;

  constructor(private readonly canvas: HTMLCanvasElement, design: Design) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.design = design;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.fitView();

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.pointer = null;
        this.message = '';
        this.changed(false);
      }
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  setDesign(d: Design): void {
    this.design = d;
    this.drag = null;
    this.selectedCell = null;
    this.selectedFurnitureId = null;
    this.sim = null; // results belong to the previous design
    this.simPlaying = false;
    this.rev++;
    this.history.clear();
    this.fitView();
    this.changed(false);
  }

  setTool(t: ToolId): void {
    this.cancelDrag();
    this.tool = t;
    this.message = '';
    this.updateCursor();
    this.changed(false);
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    this.updateCursor();
  }

  setShiftHeld(held: boolean): void {
    if (this.shiftHeld === held) return;
    this.shiftHeld = held;
    this.requestRender();
  }

  flipDoor(): void {
    this.doorFlip = !this.doorFlip;
    this.changed(false);
  }

  /** R key: flip a door's swing, or rotate the furniture ghost / selected piece. */
  rotate(): void {
    if (this.tool === 'door') {
      this.flipDoor();
    } else if (this.tool === 'furniture') {
      if (this.armedItem) {
        this.furnitureRot = nextRotation(this.furnitureRot);
        this.updateMessage();
        this.changed(false);
      } else {
        this.rotateSelectedFurniture();
      }
    }
  }

  armItem(id: string | null): void {
    this.armedItem = id;
    if (id) this.selectedFurnitureId = null;
    this.changed(false);
  }

  selectedFurniture(): Furniture | null {
    return this.design.furniture.find((f) => f.id === this.selectedFurnitureId) ?? null;
  }

  rotateSelectedFurniture(): void {
    const f = this.selectedFurniture();
    const item = f && catalogItem(f.item);
    if (!f || !item) return;
    const rot = nextRotation(f.rot);
    // Rotate about the piece's center.
    const a = rotatedSize(item, f.rot);
    const b = rotatedSize(item, rot);
    const next: Furniture = { ...f, rot, x: f.x + Math.floor((a.w - b.w) / 2), y: f.y + Math.floor((a.h - b.h) / 2) };
    const { errors } = checkFurniture(this.design, next, this.getRooms());
    if (errors.length) {
      this.message = "Can't rotate here: " + errors[0].toLowerCase();
      this.changed(false);
      return;
    }
    this.mutate((d) => updateFurniture(d, f.id, { rot: next.rot, x: next.x, y: next.y }));
  }

  deleteSelectedFurniture(): void {
    const id = this.selectedFurnitureId;
    if (id) this.mutate((d) => removeFurniture(d, id));
  }

  /** Esc: drop the armed item, then clear selections. */
  escape(): void {
    if (this.armedItem) {
      this.armItem(null);
    } else if (this.selectedFurnitureId) {
      this.selectedFurnitureId = null;
      this.changed(false);
    } else {
      this.clearSelection();
    }
  }

  /** Errors and warnings for every placed piece (cached per edit). */
  getChecks(): Map<string, FurnitureCheck> {
    if (!this.checkCache || this.checkCache.rev !== this.rev) {
      this.checkCache = { rev: this.rev, map: checkAllFurniture(this.design, this.getRooms()) };
    }
    return this.checkCache.map;
  }

  nudgeWindowLen(delta: number): void {
    const s = OPENING_SPECS.window;
    this.windowLen = Math.min(s.maxLen, Math.max(s.minLen, this.windowLen + delta));
    this.changed(false);
  }

  /** Run a design mutation as one undoable step. */
  mutate(fn: (d: Design) => boolean): boolean {
    const before = snapshot(this.design);
    if (!fn(this.design)) return false;
    this.history.record(before);
    this.changed(true);
    return true;
  }

  undo(): void {
    this.cancelDrag();
    const prev = this.history.undo(snapshot(this.design));
    if (prev) this.replaceKeepingHistory(prev);
  }

  redo(): void {
    this.cancelDrag();
    const next = this.history.redo(snapshot(this.design));
    if (next) this.replaceKeepingHistory(next);
  }

  fitView(): void {
    const { lotW, lotH } = this.design;
    const pad = 48;
    const s = Math.min((this.cssW - pad * 2) / lotW, (this.cssH - pad * 2) / lotH);
    this.cam.scale = clamp(Number.isFinite(s) && s > 0 ? s : 20, MIN_SCALE, MAX_SCALE);
    this.cam.ox = (this.cssW - lotW * this.cam.scale) / 2;
    this.cam.oy = (this.cssH - lotH * this.cam.scale) / 2;
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  // --- Simulation playback ---------------------------------------------------

  showSim(report: FlowReport): void {
    this.sim = report;
    this.simTime = 0;
    if (report.result) this.playSim();
    else this.changed(false);
  }

  playSim(): void {
    const r = this.sim?.result;
    if (!r) return;
    if (this.simTime >= r.duration) this.simTime = 0;
    this.simPlaying = true;
    this.simLast = 0;
    if (!this.simFrame) this.simFrame = requestAnimationFrame(this.simLoop);
    this.changed(false);
  }

  pauseSim(): void {
    this.simPlaying = false;
    this.changed(false);
  }

  /** Close the results (they also go away on any design edit). */
  stopSim(): void {
    this.sim = null;
    this.simPlaying = false;
    this.changed(false);
  }

  private simLoop = (ts: number): void => {
    this.simFrame = 0;
    const r = this.sim?.result;
    if (!r || !this.simPlaying) return;
    if (this.simLast) this.simTime += ((ts - this.simLast) / 1000) * this.simSpeed;
    this.simLast = ts;
    if (this.simTime >= r.duration) {
      this.simTime = r.duration;
      this.simPlaying = false;
    } else {
      this.simFrame = requestAnimationFrame(this.simLoop);
    }
    this.changed(false);
  };

  // --- Rooms ---------------------------------------------------------------

  getRooms(): RoomMap {
    if (!this.roomCache || this.roomCache.rev !== this.rev) {
      this.roomCache = { rev: this.rev, map: findRooms(this.design) };
    }
    return this.roomCache.map;
  }

  selectedRoom(): Room | null {
    if (!this.selectedCell) return null;
    return this.getRooms().byCell.get(this.selectedCell) ?? null;
  }

  clearSelection(): void {
    if (!this.selectedCell) return;
    this.selectedCell = null;
    this.changed(false);
  }

  /** Apply an edit to the selected room as one undoable step. */
  editSelectedRoom(fn: (d: Design, room: Room) => boolean): void {
    const room = this.selectedRoom();
    if (room) this.mutate((d) => fn(d, room));
  }

  private roomAt(wx: number, wy: number): Room | undefined {
    return this.getRooms().byCell.get(cellKey(Math.floor(wx), Math.floor(wy)));
  }

  private replaceKeepingHistory(s: string): void {
    this.design = restore(s);
    this.changed(true);
  }

  private changed(designChanged: boolean): void {
    if (designChanged) {
      this.rev++;
      if (this.sim) this.stopSim();
    }
    if (this.selectedCell && !this.design.footprint.has(this.selectedCell)) this.selectedCell = null;
    if (this.selectedFurnitureId && !this.selectedFurniture()) this.selectedFurnitureId = null;
    this.requestRender();
    this.onChange(designChanged);
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const firstSize = this.cssW === 0;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    if (firstSize) this.fitView();
    this.requestRender();
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.drag?.kind === 'pan' ? 'grabbing' : this.spaceHeld ? 'grab' : 'crosshair';
  }

  private toWorld(e: PointerEvent | WheelEvent): { wx: number; wy: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      wx: (e.clientX - r.left - this.cam.ox) / this.cam.scale,
      wy: (e.clientY - r.top - this.cam.oy) / this.cam.scale,
    };
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind === 'erase' && drag.changed) {
      this.history.record(drag.before);
      this.changed(true);
    } else if (drag?.kind === 'move') {
      updateFurniture(this.design, drag.id, { x: drag.ox, y: drag.oy });
      this.rev++;
    }
    this.updateCursor();
    this.requestRender();
  }

  private screenPos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.screenPos(e));
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2 || this.gestureLock) return;

    const p = this.toWorld(e);
    this.pointer = p;
    const remove = e.button === 2 || e.shiftKey || this.removeMode;

    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.cam.ox, oy: this.cam.oy };
      this.updateCursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    switch (this.tool) {
      case 'footprint': {
        const x = Math.floor(p.wx);
        const y = Math.floor(p.wy);
        this.drag = { kind: 'rect', add: !remove, x0: x, y0: y, x1: x, y1: y };
        break;
      }
      case 'wall': {
        const x = Math.round(p.wx);
        const y = Math.round(p.wy);
        this.drag = { kind: 'line', add: !remove, ax: x, ay: y, bx: x, by: y };
        break;
      }
      case 'furniture': {
        const hit = furnitureAt(this.design, cellKey(Math.floor(p.wx), Math.floor(p.wy)));
        if (!remove && hit && !(this.armedItem && this.ghostOk(p.wx, p.wy))) {
          // Pressing a placed piece picks it up (unless the armed item fits here, e.g. a rug under a sofa).
          this.selectedFurnitureId = hit.id;
          this.armedItem = null;
          this.drag = {
            kind: 'move',
            id: hit.id,
            offX: Math.floor(p.wx) - hit.x,
            offY: Math.floor(p.wy) - hit.y,
            before: snapshot(this.design),
            ox: hit.x,
            oy: hit.y,
          };
        } else {
          this.drag = { kind: 'tap', remove };
        }
        break;
      }
      case 'erase': {
        this.drag = { kind: 'erase', before: snapshot(this.design), changed: false, layer: null };
        this.eraseAt(p.wx, p.wy);
        break;
      }
      default:
        // Doors, windows and room picking act when the pointer is released, so a finger
        // can slide to the right spot first (and a second finger can start a pinch instead).
        this.drag = { kind: 'tap', remove };
    }
    this.updateMessage();
    this.changed(false);
  }

  /** Click/tap actions, run on release at the final pointer position. */
  private tapAt(wx: number, wy: number, remove: boolean): void {
    switch (this.tool) {
      case 'door':
      case 'window': {
        if (remove) {
          const op = this.openingUnder(wx, wy);
          if (op && this.mutate((d) => removeOpening(d, op.id))) this.sound('remove');
        } else {
          const op = this.openingPreview(wx, wy);
          if (op && openingProblem(this.design, op) === null) {
            this.mutate((d) => addOpening(d, { ...op, id: newId() }));
            this.sound('place');
          } else if (op) {
            this.sound('error');
          }
        }
        break;
      }
      case 'room': {
        const room = this.roomAt(wx, wy);
        this.selectedCell = room ? cellKey(Math.floor(wx), Math.floor(wy)) : null;
        break;
      }
      case 'furniture': {
        const hit = furnitureAt(this.design, cellKey(Math.floor(wx), Math.floor(wy)));
        if (remove) {
          if (hit && this.mutate((d) => removeFurniture(d, hit.id))) this.sound('remove');
        } else if (this.armedItem) {
          const g = this.ghost(wx, wy);
          if (g && this.ghostOk(wx, wy)) {
            this.mutate((d) => addFurniture(d, { ...g, id: newId() }));
            this.sound('place');
          } else {
            this.sound('error');
          }
        } else {
          this.selectedFurnitureId = null;
        }
        break;
      }
      default:
        break;
    }
  }

  private startPinch(): void {
    this.cancelDrag();
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      scale: this.cam.scale,
      ox: this.cam.ox,
      oy: this.cam.oy,
    };
    this.gestureLock = true;
    this.pointer = null;
    this.message = '';
    this.changed(false);
  }

  private updatePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const scale = clamp(pinch.scale * (dist / pinch.dist), MIN_SCALE, MAX_SCALE);
    // Keep the world point that started under the fingers' midpoint under the current midpoint.
    const wx = (pinch.mx - pinch.ox) / pinch.scale;
    const wy = (pinch.my - pinch.oy) / pinch.scale;
    this.cam.scale = scale;
    this.cam.ox = mx - wx * scale;
    this.cam.oy = my - wy * scale;
    this.requestRender();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.screenPos(e));
    if (this.pinch) {
      if (this.pointers.size >= 2) this.updatePinch();
      return;
    }
    if (this.gestureLock) return;

    const p = this.toWorld(e);
    this.pointer = p;
    const drag = this.drag;
    if (drag?.kind === 'pan') {
      this.cam.ox = drag.ox + (e.clientX - drag.sx);
      this.cam.oy = drag.oy + (e.clientY - drag.sy);
    } else if (drag?.kind === 'rect') {
      drag.x1 = Math.floor(p.wx);
      drag.y1 = Math.floor(p.wy);
    } else if (drag?.kind === 'line') {
      // Constrain to the dominant axis.
      const x = Math.round(p.wx);
      const y = Math.round(p.wy);
      if (Math.abs(x - drag.ax) >= Math.abs(y - drag.ay)) {
        drag.bx = x;
        drag.by = drag.ay;
      } else {
        drag.bx = drag.ax;
        drag.by = y;
      }
    } else if (drag?.kind === 'erase') {
      this.eraseAt(p.wx, p.wy);
    } else if (drag?.kind === 'move') {
      const x = Math.floor(p.wx) - drag.offX;
      const y = Math.floor(p.wy) - drag.offY;
      if (updateFurniture(this.design, drag.id, { x, y })) this.rev++;
    }
    this.updateMessage();
    this.changed(false);
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.gestureLock = this.pointers.size > 0;
    this.cancelDrag();
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pinch || this.gestureLock) {
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.gestureLock = false;
      return;
    }

    const drag = this.drag;
    this.drag = null;
    const p = this.toWorld(e);
    if (drag?.kind === 'rect') {
      if (this.mutate((d) => paintFootprint(d, drag.x0, drag.y0, drag.x1, drag.y1, drag.add))) this.sound(drag.add ? 'draw' : 'remove');
    } else if (drag?.kind === 'line') {
      const keys = lineEdges(drag.ax, drag.ay, drag.bx, drag.by);
      if (this.mutate((d) => (drag.add ? addWalls(d, keys) : removeWalls(d, keys)))) this.sound(drag.add ? 'draw' : 'remove');
    } else if (drag?.kind === 'erase' && drag.changed) {
      this.history.record(drag.before);
      this.changed(true);
      this.sound('remove');
    } else if (drag?.kind === 'move') {
      this.finishMove(drag);
    } else if (drag?.kind === 'tap') {
      this.tapAt(p.wx, p.wy, drag.remove);
    }
    // A finger has no hover: once it lifts, drop the ghost/preview.
    if (e.pointerType === 'touch') this.pointer = null;
    this.updateCursor();
    this.changed(false);
  }

  private finishMove(drag: Extract<Drag, { kind: 'move' }>): void {
    const f = this.design.furniture.find((o) => o.id === drag.id);
    if (!f || (f.x === drag.ox && f.y === drag.oy)) return;
    const { errors } = checkFurniture(this.design, f, this.getRooms());
    if (errors.length) {
      // Snap back to where it was.
      updateFurniture(this.design, f.id, { x: drag.ox, y: drag.oy });
      this.rev++;
      this.message = "Can't move there: " + errors[0].toLowerCase();
      this.sound('error');
      return;
    }
    this.history.record(drag.before);
    this.changed(true);
    this.sound('place');
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { wx, wy } = this.toWorld(e);
    const next = clamp(this.cam.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    const r = this.canvas.getBoundingClientRect();
    this.cam.scale = next;
    this.cam.ox = e.clientX - r.left - wx * next;
    this.cam.oy = e.clientY - r.top - wy * next;
    this.requestRender();
  }

  /** Erase whatever is under the pointer. Within one drag, sticks to the first layer erased (openings or walls). */
  private eraseAt(wx: number, wy: number): void {
    const drag = this.drag;
    if (drag?.kind !== 'erase') return;
    if (drag.layer === null || drag.layer === 'furniture') {
      const hit = furnitureAt(this.design, cellKey(Math.floor(wx), Math.floor(wy)));
      if (hit) {
        removeFurniture(this.design, hit.id);
        drag.layer = 'furniture';
        drag.changed = true;
        this.rev++;
        return;
      }
      if (drag.layer === 'furniture') return;
    }
    const edge = this.edgeUnder(wx, wy);
    if (!edge) return;
    const key = edgeKey(edge.o, edge.x, edge.y);
    const op = openingOnEdge(this.design, key);
    if (op && drag.layer !== 'wall') {
      removeOpening(this.design, op.id);
      this.rev++;
      drag.layer = 'opening';
      drag.changed = true;
    } else if (!op && this.design.walls.has(key) && drag.layer !== 'opening') {
      removeWalls(this.design, [key]);
      drag.layer = 'wall';
      drag.changed = true;
      this.rev++; // rooms may have merged
    }
  }

  private edgeUnder(wx: number, wy: number): Edge | null {
    const e = nearestEdge(wx, wy, EDGE_PICK);
    return e && edgeInLot(this.design, e) ? e : null;
  }

  private openingUnder(wx: number, wy: number): Opening | undefined {
    const e = this.edgeUnder(wx, wy);
    return e ? openingOnEdge(this.design, edgeKey(e.o, e.x, e.y)) : undefined;
  }

  /** The opening the door/window tool would place at this point (not yet validated). */
  private openingPreview(wx: number, wy: number): Opening | null {
    if (this.tool !== 'door' && this.tool !== 'window') return null;
    const e = nearestEdge(wx, wy, EDGE_PICK);
    if (!e) return null;
    const kind = this.tool === 'window' ? 'window' : this.doorKind;
    const len = kind === 'window' ? this.windowLen : OPENING_SPECS[kind].defaultLen;
    const along = e.o === 'h' ? wx : wy;
    const start = Math.round(along - len / 2);
    return {
      id: 'preview',
      kind,
      o: e.o,
      x: e.o === 'h' ? start : e.x,
      y: e.o === 'h' ? e.y : start,
      len,
      flip: this.doorFlip,
    };
  }

  private updateMessage(): void {
    this.message = '';
    const p = this.pointer;
    if (!p || this.drag) return;
    const op = this.openingPreview(p.wx, p.wy);
    if (op) this.message = openingProblem(this.design, op) ?? '';
    const g = this.ghost(p.wx, p.wy);
    if (g) {
      const c = checkFurniture(this.design, g, this.getRooms());
      this.message = c.errors[0] ?? c.warnings[0] ?? '';
    }
  }

  /** The piece the Furniture tool would place at this point (not yet validated). */
  private ghost(wx: number, wy: number): Furniture | null {
    if (this.tool !== 'furniture' || !this.armedItem) return null;
    const item = catalogItem(this.armedItem);
    if (!item) return null;
    const { w, h } = rotatedSize(item, this.furnitureRot);
    return { id: 'ghost', item: item.id, x: Math.round(wx - w / 2), y: Math.round(wy - h / 2), rot: this.furnitureRot };
  }

  private ghostOk(wx: number, wy: number): boolean {
    const g = this.ghost(wx, wy);
    return !!g && checkFurniture(this.design, g, this.getRooms()).errors.length === 0;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private draw(): void {
    const { ctx, cam, design: d } = this;
    const s = cam.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // World space: 1 unit = 1 cell.
    ctx.save();
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(s, s);

    ctx.fillStyle = COLORS.lot;
    ctx.fillRect(0, 0, d.lotW, d.lotH);

    cellsPath(ctx, d.footprint);
    ctx.fillStyle = COLORS.footprint;
    ctx.fill();
    this.drawFloors();
    ctx.restore();

    this.drawGrid();

    ctx.save();
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(s, s);
    this.drawOpenAreas();
    this.drawHeat();
    this.drawFurnitureLayer('floor');
    if (this.tool === 'furniture') this.drawClearances();
    this.drawWallFinishes();
    this.drawWalls();
    for (const op of d.openings) this.drawOpening(op, null);
    this.drawFurnitureLayer('object');
    this.drawFurnitureLayer('wall');
    this.drawFurnitureLayer('ceiling');
    this.drawSimPeople();
    this.drawRoomOutlines();
    this.drawPreview();
    ctx.restore();

    this.drawRoomLabels();
    this.drawFurnitureBadges();
    this.drawLabels();
  }

  /** Floor materials, grouped so each material is one fill. */
  private drawFloors(): void {
    const { ctx, design: d } = this;
    const groups = new Map<string, string[]>();
    for (const [cell, id] of d.floors) {
      const list = groups.get(id);
      if (list) list.push(cell);
      else groups.set(id, [cell]);
    }
    ctx.globalAlpha = 0.55;
    for (const [id, cells] of groups) {
      const mat = floorMaterial(id);
      if (!mat) continue;
      cellsPath(ctx, cells);
      ctx.fillStyle = mat.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Hatch areas that aren't fully walled in. */
  private drawOpenAreas(): void {
    const { ctx } = this;
    for (const room of this.getRooms().rooms) {
      if (room.enclosed) continue;
      ctx.save();
      cellsPath(ctx, room.cells);
      ctx.clip();
      const [x0, y0, x1, y1] = cellBounds(room.cells);
      ctx.beginPath();
      const h = y1 + 1 - y0;
      for (let k = x0; k <= x1 + 1 + h; k++) {
        ctx.moveTo(k, y0);
        ctx.lineTo(k - h, y1 + 1);
      }
      ctx.strokeStyle = COLORS.openHatch;
      ctx.lineWidth = 1.5 / this.cam.scale;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** A thin strip of finish color on the room-facing side of each finished wall. */
  private drawWallFinishes(): void {
    const { ctx, design: d } = this;
    const openKeys = new Set(d.openings.flatMap((op) => openingEdges(op)));
    const w = 0.16;
    for (const [key, id] of d.wallFinishes) {
      const fin = wallFinish(id);
      const { edge, side } = parseSideKey(key);
      if (!fin || openKeys.has(edge)) continue;
      const t = wallKind(d, edge) === 'exterior' ? 0.5 : 0.3;
      const e = parseEdge(edge);
      ctx.fillStyle = fin.color;
      if (e.o === 'h') ctx.fillRect(e.x, side === 1 ? e.y + t / 2 : e.y - t / 2 - w, 1, w);
      else ctx.fillRect(side === 1 ? e.x + t / 2 : e.x - t / 2 - w, e.y, w, 1);
    }
  }

  /** Outline the selected room (and the hovered one, with the Room tool). */
  private drawRoomOutlines(): void {
    const { ctx } = this;
    const outline = (room: Room, color: string, px: number) => {
      ctx.beginPath();
      for (const k of room.boundary) {
        const e = parseEdge(k);
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.o === 'h' ? e.x + 1 : e.x, e.o === 'h' ? e.y : e.y + 1);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = px / this.cam.scale;
      ctx.lineCap = 'square';
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    const selected = this.selectedRoom();
    if (this.tool === 'room' && this.pointer && !this.drag) {
      const hover = this.roomAt(this.pointer.wx, this.pointer.wy);
      if (hover && hover !== selected) outline(hover, COLORS.hover, 2);
    }
    if (selected) outline(selected, COLORS.selected, 3);
  }

  /** Room name and area at each room's middle. */
  private drawRoomLabels(): void {
    const { ctx, cam } = this;
    if (cam.scale < 9) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of this.getRooms().rooms) {
      if (room.cells.length < 4) continue;
      const [lx, ly] = room.labelCell;
      const x = (lx + 0.5) * cam.scale + cam.ox;
      const y = (ly + 0.5) * cam.scale + cam.oy;
      const type = roomType(room.type);
      const title = !room.enclosed ? 'Not enclosed' : type ? type.name : 'Unassigned room';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.labelHalo;
      ctx.fillStyle = !room.enclosed ? COLORS.warn : type ? COLORS.labelText : COLORS.muted;
      ctx.strokeText(title, x, y - 7);
      ctx.fillText(title, x, y - 7);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = COLORS.muted;
      const area = `${room.areaM2.toFixed(1)} m²`;
      ctx.strokeText(area, x, y + 8);
      ctx.fillText(area, x, y + 8);
    }
    ctx.textAlign = 'start';
  }

  private drawGrid(): void {
    const { ctx, cam, design: d } = this;
    const s = cam.scale;
    const x0 = Math.max(0, Math.floor(-cam.ox / s));
    const x1 = Math.min(d.lotW, Math.ceil((this.cssW - cam.ox) / s));
    const y0 = Math.max(0, Math.floor(-cam.oy / s));
    const y1 = Math.min(d.lotH, Math.ceil((this.cssH - cam.oy) / s));
    const px = (v: number, o: number) => Math.round(v * s + o) + 0.5;

    const pass = (style: string, test: (i: number) => boolean) => {
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        if (!test(x)) continue;
        ctx.moveTo(px(x, cam.ox), cam.oy);
        ctx.lineTo(px(x, cam.ox), cam.oy + d.lotH * s);
      }
      for (let y = y0; y <= y1; y++) {
        if (!test(y)) continue;
        ctx.moveTo(cam.ox, px(y, cam.oy));
        ctx.lineTo(cam.ox + d.lotW * s, px(y, cam.oy));
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    if (s >= 8) pass(COLORS.gridMinor, (i) => i % 2 !== 0);
    pass(COLORS.gridMeter, (i) => i % 2 === 0 && i % 10 !== 0);
    pass(COLORS.gridFive, (i) => i % 10 === 0);

    ctx.strokeStyle = COLORS.lotBorder;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cam.ox, cam.oy, d.lotW * s, d.lotH * s);
    ctx.setLineDash([]);
  }

  private drawWalls(): void {
    const { ctx, design: d } = this;
    const openingKeys = new Set(d.openings.flatMap((op) => openingEdges(op)));
    const isOpen = (o: 'h' | 'v', x: number, y: number) => openingKeys.has(edgeKey(o, x, y));

    for (const pass of ['interior', 'exterior'] as const) {
      ctx.fillStyle = pass === 'exterior' ? COLORS.wallExt : COLORS.wallInt;
      const t = pass === 'exterior' ? 0.5 : 0.3;
      for (const k of d.walls) {
        if (openingKeys.has(k) || wallKind(d, k) !== pass) continue;
        const e = parseEdge(k);
        // Square end caps fill corners, except where the wall runs into a door or window.
        if (e.o === 'h') {
          const capL = isOpen('h', e.x - 1, e.y) ? 0 : t / 2;
          const capR = isOpen('h', e.x + 1, e.y) ? 0 : t / 2;
          ctx.fillRect(e.x - capL, e.y - t / 2, 1 + capL + capR, t);
        } else {
          const capT = isOpen('v', e.x, e.y - 1) ? 0 : t / 2;
          const capB = isOpen('v', e.x, e.y + 1) ? 0 : t / 2;
          ctx.fillRect(e.x - t / 2, e.y - capT, t, 1 + capT + capB);
        }
      }
    }
  }

  /** Draw an opening. `tint` overrides colors for placement previews. */
  private drawOpening(op: Opening, tint: string | null): void {
    const { ctx } = this;
    const lw = 1.5 / this.cam.scale;
    const ext = wallKind(this.design, openingEdges(op)[0]) === 'exterior';
    const t = ext ? 0.5 : 0.3;
    // Unit vectors along the opening and toward the swing side.
    const ax = op.o === 'h' ? 1 : 0;
    const ay = op.o === 'h' ? 0 : 1;
    const side = op.flip ? -1 : 1;
    const nx = op.o === 'h' ? 0 : side;
    const ny = op.o === 'h' ? side : 0;
    const ex = op.x + ax * op.len;
    const ey = op.y + ay * op.len;

    if (op.kind === 'window') {
      const color = tint ?? COLORS.window;
      ctx.fillStyle = withAlpha(color, 0.25);
      if (op.o === 'h') ctx.fillRect(op.x, op.y - t / 2, op.len, t);
      else ctx.fillRect(op.x - t / 2, op.y, t, op.len);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const off of [-t / 2, 0, t / 2]) {
        const ox = op.o === 'h' ? 0 : off;
        const oy = op.o === 'h' ? off : 0;
        ctx.moveTo(op.x + ox, op.y + oy);
        ctx.lineTo(ex + ox, ey + oy);
      }
      ctx.stroke();
      return;
    }

    const color = tint ?? COLORS.door;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    // Threshold
    ctx.setLineDash([0.15, 0.15]);
    ctx.beginPath();
    ctx.moveTo(op.x, op.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    const leaves: Array<{ hx: number; hy: number; dirX: number; dirY: number; r: number }> =
      op.kind === 'double-door'
        ? [
            { hx: op.x, hy: op.y, dirX: ax, dirY: ay, r: op.len / 2 },
            { hx: ex, hy: ey, dirX: -ax, dirY: -ay, r: op.len / 2 },
          ]
        : [{ hx: op.x, hy: op.y, dirX: ax, dirY: ay, r: op.len }];

    for (const leaf of leaves) {
      let aClosed = Math.atan2(leaf.dirY, leaf.dirX);
      let aOpen = Math.atan2(ny, nx);
      if (Math.abs(aOpen - aClosed) > Math.PI) {
        if (aOpen < aClosed) aOpen += Math.PI * 2;
        else aClosed += Math.PI * 2;
      }
      ctx.beginPath();
      ctx.moveTo(leaf.hx, leaf.hy);
      ctx.lineTo(leaf.hx + nx * leaf.r, leaf.hy + ny * leaf.r);
      ctx.lineWidth = lw * 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(leaf.hx, leaf.hy, leaf.r, Math.min(aClosed, aOpen), Math.max(aClosed, aOpen));
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  /** Where people spent their time: yellow (some) to red (a lot). */
  private drawHeat(): void {
    const sim = this.sim;
    if (!sim?.result || !this.showHeat) return;
    const { ctx } = this;
    const { heat } = sim.result;
    const g = sim.grid;
    let max = 0;
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] > max && this.design.footprint.has(cellKey(i % g.w, Math.floor(i / g.w)))) max = heat[i];
    }
    if (max <= 0) return;
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] <= 0) continue;
      const v = Math.min(1, Math.sqrt(heat[i] / max));
      // Hue 55 (yellow) down to 0 (red) as it gets busier.
      ctx.fillStyle = `hsla(${Math.round(55 - 55 * v)}, 95%, 55%, ${0.15 + 0.5 * v})`;
      ctx.fillRect(i % g.w, Math.floor(i / g.w), 1, 1);
    }
    // Ring the worst bottleneck.
    const hot = sim.issues.find((iss) => iss.cell !== undefined)?.cell;
    if (hot !== undefined) {
      ctx.strokeStyle = COLORS.bad;
      ctx.lineWidth = 2.5 / this.cam.scale;
      ctx.beginPath();
      ctx.arc((hot % g.w) + 0.5, Math.floor(hot / g.w) + 0.5, 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Simulated people at the current playback time. */
  private drawSimPeople(): void {
    const r = this.sim?.result;
    if (!r || r.frameCount === 0) return;
    const { ctx } = this;
    const f = Math.min(r.frameCount - 1, Math.floor(this.simTime / r.dt));
    ctx.lineWidth = 1.5 / this.cam.scale;
    ctx.strokeStyle = 'rgba(8, 16, 28, 0.9)';
    for (let a = 0; a < r.agentCount; a++) {
      const o = (f * r.agentCount + a) * 2;
      const x = r.frames[o];
      if (Number.isNaN(x)) continue;
      const y = r.frames[o + 1];
      const phase = r.phases[f * r.agentCount + a];
      ctx.fillStyle = phase === PHASE_BLOCKED ? COLORS.bad : phase === PHASE_DWELL ? COLORS.warn : COLORS.person;
      ctx.beginPath();
      ctx.arc(x, y, 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawFurnitureLayer(layer: CatalogItem['layer']): void {
    for (const f of this.design.furniture) {
      const item = catalogItem(f.item);
      if (item?.layer === layer) this.drawPiece(f, item, null);
    }
  }

  /** Draw a piece. `tint` replaces its color for placement ghosts. */
  private drawPiece(f: Furniture, item: CatalogItem, tint: string | null): void {
    const { ctx } = this;
    const { w, h } = rotatedSize(item, f.rot);
    const px = 1 / this.cam.scale;
    const color = tint ?? item.color;
    const ink = 'rgba(0, 0, 0, 0.55)';
    ctx.save();
    if (tint) ctx.globalAlpha = 0.85;

    if (item.layer === 'floor') {
      ctx.globalAlpha *= 0.6;
      ctx.fillStyle = color;
      ctx.fillRect(f.x + 0.1, f.y + 0.1, w - 0.2, h - 0.2);
      ctx.globalAlpha = tint ? 0.85 : 1;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeStyle = ink;
      ctx.lineWidth = px;
      ctx.strokeRect(f.x + 0.3, f.y + 0.3, w - 0.6, h - 0.6);
      ctx.setLineDash([]);
    } else if (item.layer === 'ceiling') {
      ctx.globalAlpha *= 0.3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(f.x + w / 2, f.y + h / 2, w / 2 - 0.1, h / 2 - 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = tint ? 0.85 : 1;
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (item.layer === 'wall') {
      // A thin bar along the wall it hangs on.
      const depth = 0.35;
      const back = f.rot % 4;
      const r: [number, number, number, number] =
        back === 0
          ? [f.x, f.y, w, depth]
          : back === 1
            ? [f.x + w - depth, f.y, depth, h]
            : back === 2
              ? [f.x, f.y + h - depth, w, depth]
              : [f.x, f.y, depth, h];
      ctx.fillStyle = color;
      ctx.fillRect(...r);
      ctx.strokeStyle = ink;
      ctx.lineWidth = px;
      ctx.strokeRect(...r);
    } else {
      const inset = 0.06;
      ctx.fillStyle = color;
      roundRect(ctx, f.x + inset, f.y + inset, w - inset * 2, h - inset * 2, Math.min(0.25, w / 4, h / 4));
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = px;
      ctx.stroke();
      // A light bar marks the front.
      const front = (2 + f.rot) % 4;
      const i = 0.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      if (front === 0) {
        ctx.moveTo(f.x + i, f.y + i);
        ctx.lineTo(f.x + w - i, f.y + i);
      } else if (front === 1) {
        ctx.moveTo(f.x + w - i, f.y + i);
        ctx.lineTo(f.x + w - i, f.y + h - i);
      } else if (front === 2) {
        ctx.moveTo(f.x + i, f.y + h - i);
        ctx.lineTo(f.x + w - i, f.y + h - i);
      } else {
        ctx.moveTo(f.x + i, f.y + i);
        ctx.lineTo(f.x + i, f.y + h - i);
      }
      ctx.stroke();
    }

    if (!tint) {
      const check = this.getChecks().get(f.id);
      const selected = f.id === this.selectedFurnitureId;
      if (check?.errors.length || selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = check?.errors.length ? COLORS.bad : COLORS.selected;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(f.x - 2 * px, f.y - 2 * px, w + 4 * px, h + 4 * px);
      }
    }
    ctx.restore();
  }

  private drawClearance(f: Furniture, item: CatalogItem, fill: string): void {
    const cells = clearanceCells(item, f);
    if (!cells.length) return;
    cellsPath(this.ctx, cells);
    this.ctx.fillStyle = fill;
    this.ctx.fill();
  }

  /** Faint clearance zones for every placed piece, shown while using the Furniture tool. */
  private drawClearances(): void {
    for (const f of this.design.furniture) {
      const item = catalogItem(f.item);
      if (item?.layer === 'object') this.drawClearance(f, item, COLORS.clearance);
    }
  }

  /** "!" badges on pieces with problems. */
  private drawFurnitureBadges(): void {
    const { ctx, cam } = this;
    if (cam.scale < 8) return;
    const checks = this.getChecks();
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.design.furniture) {
      const check = checks.get(f.id);
      const item = catalogItem(f.item);
      if (!check || !item || (!check.errors.length && !check.warnings.length)) continue;
      const { w } = rotatedSize(item, f.rot);
      const x = (f.x + w) * cam.scale + cam.ox - 2;
      const y = f.y * cam.scale + cam.oy + 2;
      ctx.fillStyle = check.errors.length ? COLORS.bad : COLORS.warn;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1405';
      ctx.fillText('!', x, y + 0.5);
    }
    ctx.textAlign = 'start';
  }

  private drawPreview(): void {
    const { ctx, drag, pointer } = this;
    const lw = 2 / this.cam.scale;

    if (drag?.kind === 'rect') {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0) + 1;
      const h = Math.abs(drag.y1 - drag.y0) + 1;
      ctx.fillStyle = drag.add ? COLORS.okFill : COLORS.badFill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = drag.add ? COLORS.ok : COLORS.bad;
      ctx.lineWidth = lw;
      ctx.strokeRect(x, y, w, h);
      return;
    }

    if (drag?.kind === 'line') {
      ctx.strokeStyle = drag.add ? COLORS.ok : COLORS.bad;
      ctx.lineWidth = 0.35;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(drag.ax, drag.ay);
      ctx.lineTo(drag.bx, drag.by);
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }

    if (drag || !pointer) return;

    const g = this.ghost(pointer.wx, pointer.wy);
    if (g) {
      const item = catalogItem(g.item);
      if (!item) return;
      const check = checkFurniture(this.design, g, this.getRooms());
      const color = check.errors.length ? COLORS.bad : check.warnings.length ? COLORS.warn : COLORS.ok;
      if (item.layer === 'object') this.drawClearance(g, item, withAlpha(color, 0.18));
      this.drawPiece(g, item, color);
      return;
    }

    if (this.tool === 'wall') {
      ctx.fillStyle = this.shiftHeld || this.removeMode ? COLORS.bad : COLORS.ok;
      ctx.beginPath();
      ctx.arc(Math.round(pointer.wx), Math.round(pointer.wy), 5 / this.cam.scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.tool === 'footprint') {
      ctx.strokeStyle = this.shiftHeld || this.removeMode ? COLORS.bad : COLORS.ok;
      ctx.lineWidth = lw;
      ctx.strokeRect(Math.floor(pointer.wx), Math.floor(pointer.wy), 1, 1);
    } else if (this.tool === 'door' || this.tool === 'window') {
      const op = this.openingPreview(pointer.wx, pointer.wy);
      if (op) this.drawOpening(op, openingProblem(this.design, op) ? COLORS.bad : COLORS.ok);
    } else if (this.tool === 'erase') {
      const e = this.edgeUnder(pointer.wx, pointer.wy);
      if (!e) return;
      const key = edgeKey(e.o, e.x, e.y);
      const op = openingOnEdge(this.design, key);
      if (!op && !this.design.walls.has(key)) return;
      const edges = op ? openingEdges(op) : [key];
      ctx.fillStyle = COLORS.bad;
      for (const k of edges) {
        const ed = parseEdge(k);
        if (ed.o === 'h') ctx.fillRect(ed.x, ed.y - 0.3, 1, 0.6);
        else ctx.fillRect(ed.x - 0.3, ed.y, 0.6, 1);
      }
    }
  }

  private drawLabels(): void {
    const { drag, pointer } = this;
    if (!pointer) return;
    const r = this.toScreen(pointer.wx, pointer.wy);
    let text = '';
    if (drag?.kind === 'rect') {
      const w = Math.abs(drag.x1 - drag.x0) + 1;
      const h = Math.abs(drag.y1 - drag.y0) + 1;
      text = `${fmtMeters(w)} × ${fmtMeters(h)}`;
    } else if (drag?.kind === 'line') {
      text = fmtMeters(Math.abs(drag.bx - drag.ax) + Math.abs(drag.by - drag.ay));
    } else if (!drag && this.tool === 'window') {
      text = `Window ${fmtMeters(this.windowLen)}`;
    }
    if (!text) return;
    const { ctx } = this;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const x = Math.min(r.x + 14, this.cssW - w - 4);
    const y = Math.max(r.y - 30, 4);
    ctx.fillStyle = COLORS.labelBg;
    roundRect(ctx, x, y, w, 22, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.labelText;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + 11);
  }

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.cam.scale + this.cam.ox, y: wy * this.cam.scale + this.cam.oy };
  }
}

/** Build a path covering the given cells (one rect each; a single fill avoids seams). */
function cellsPath(ctx: CanvasRenderingContext2D, cells: Iterable<string>): void {
  ctx.beginPath();
  for (const k of cells) {
    const [x, y] = parseCell(k);
    ctx.rect(x, y, 1, 1);
  }
}

/** [minX, minY, maxX, maxY] over cell keys. */
function cellBounds(cells: string[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const k of cells) {
    const [x, y] = parseCell(k);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function withAlpha(rgba: string, a: number): string {
  if (rgba.startsWith('#') && rgba.length === 7) {
    const n = parseInt(rgba.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return rgba.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3, ${a})`);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
